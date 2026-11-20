import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env, getPaymentIntegrationsStatus } from '../config/env';
import { AppError } from '../middleware/error.middleware';
import { OrderModel, PaymentTransactionModel, serializePaymentTransaction, type IOrder } from '../modules/orders/order.model';
import { ProductModel } from '../modules/products/product.model';
import { CartModel } from '../modules/cart/cart.model';
import { InventoryMovementModel } from '../modules/inventory/inventoryMovement.model';
import { HomepageConfigModel } from '../modules/cms/cms.model';
import { SystemLogModel } from '../modules/support/support.model';
import { recordAuditLog } from '../middleware/auth.middleware';
import { sendTransactionalEmail } from './email.service';
import {
  canRetryOrderPayment,
  computeRefundableBalance,
  canRefundPaymentTransaction,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentTransactionStatus,
} from '../../../src/lib/orderStateMachine';
import {
  amountsMatch,
  redactGatewayPayload,
  type GatewayInitiateOutput,
  type GatewayRefundOutput,
  type GatewayVerifyOutput,
} from './gateways/types';
import {
  initiateSslCommerzSession,
  querySslCommerzByTranId,
  refundSslCommerzPayment,
  verifySslCommerzPayment,
} from './gateways/sslcommerz.adapter';
import {
  executeAndVerifyBkashPayment,
  initiateBkashPayment,
  queryBkashPaymentStatus,
  refundBkashPayment,
} from './gateways/bkash.adapter';
import { initiateNagadPayment, verifyNagadPayment } from './gateways/nagad.adapter';

export interface InitiateGatewayParams {
  orderNumber: string;
  transactionId: string;
  amount: number;
  paymentMethod?: PaymentMethod;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  clientIp?: string;
  shippingAddress: {
    house: string;
    area: string;
    upazila: string;
    district: string;
    division: string;
    postalCode?: string;
  };
}

export function getPaymentCapabilities() {
  const status = getPaymentIntegrationsStatus();
  return {
    cod: { configured: true, mode: 'offline' as const },
    bkash: { configured: status.bkash, mode: status.modes.bkash },
    nagad: { configured: status.nagad, mode: status.modes.nagad },
    sslcommerz: { configured: status.sslcommerz, mode: status.modes.sslcommerz },
    card: { configured: status.card, mode: status.modes.card },
    anyOnline: status.anyOnline,
  };
}

export function resolveProviderForMethod(paymentMethod: PaymentMethod): PaymentProvider {
  if (paymentMethod === 'cod') return 'cod';
  if (paymentMethod === 'bkash') return 'bkash';
  if (paymentMethod === 'nagad') return 'nagad';
  return 'sslcommerz';
}

export function isPaymentMethodConfigured(paymentMethod: PaymentMethod): boolean {
  if (paymentMethod === 'cod') return true;
  const status = getPaymentIntegrationsStatus();
  if (paymentMethod === 'bkash') return status.bkash;
  if (paymentMethod === 'nagad') return status.nagad;
  if (paymentMethod === 'card') return status.card;
  return status.sslcommerz;
}

export function getUnconfiguredMethodMessage(paymentMethod: PaymentMethod): string {
  switch (paymentMethod) {
    case 'bkash':
      return 'bKash merchant credentials (BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD) are not configured on this server.';
    case 'nagad':
      return 'Nagad merchant credentials (NAGAD_MERCHANT_ID, NAGAD_MERCHANT_NUMBER, NAGAD_PUBLIC_KEY, NAGAD_PRIVATE_KEY) are not configured on this server.';
    case 'card':
      return 'Card payment gateway credentials (PAYMENT_STORE_ID, PAYMENT_STORE_PASSWORD) are not configured on this server.';
    case 'sslcommerz':
      return 'SSLCommerz credentials (PAYMENT_STORE_ID, PAYMENT_STORE_PASSWORD) are not configured on this server.';
    default:
      return 'Selected payment gateway is not configured.';
  }
}

async function writePaymentSystemLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  details?: Record<string, unknown>,
) {
  await SystemLogModel.create({
    level,
    source: 'payment.gateway',
    message,
    details: details ? redactGatewayPayload(details) : undefined,
  }).catch(() => undefined);
}

// Legacy compatibility wrapper
export async function initiateSslCommerzPayment(params: InitiateGatewayParams): Promise<{
  gatewayUrl: string;
  sessionKey?: string;
}> {
  const res = await initiateSslCommerzSession({
    ...params,
    currency: 'BDT',
    paymentMethod: params.paymentMethod || 'sslcommerz',
  });
  return { gatewayUrl: res.gatewayUrl, sessionKey: res.gatewaySessionKey };
}

// Legacy compatibility wrapper
export async function validateSslCommerzTransaction(valId: string): Promise<{
  verified: boolean;
  status?: string;
  amount?: number;
  tranId?: string;
  bankTranId?: string;
  raw?: Record<string, unknown>;
}> {
  const res = await verifySslCommerzPayment({
    transactionId: '',
    expectedAmount: 1,
    gatewayValidationId: valId,
  });
  return {
    verified: res.verified,
    status: res.status,
    amount: res.verifiedAmount,
    tranId: res.tranId,
    bankTranId: res.bankTransactionId,
    raw: res.raw,
  };
}

export async function dispatchGatewaySession(params: InitiateGatewayParams): Promise<GatewayInitiateOutput> {
  const method = params.paymentMethod || 'sslcommerz';
  if (!isPaymentMethodConfigured(method)) {
    throw new AppError(503, 'PAYMENT_GATEWAY_UNCONFIGURED', getUnconfiguredMethodMessage(method));
  }

  const input = {
    orderNumber: params.orderNumber,
    transactionId: params.transactionId,
    amount: params.amount,
    currency: 'BDT' as const,
    paymentMethod: method,
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    customerPhone: params.customerPhone,
    clientIp: params.clientIp,
    shippingAddress: params.shippingAddress,
  };

  if (method === 'bkash') {
    return initiateBkashPayment(input);
  }
  if (method === 'nagad') {
    return initiateNagadPayment(input);
  }
  return initiateSslCommerzSession(input);
}

export async function createAndInitiatePaymentTransaction(params: {
  order: IOrder;
  paymentMethod: PaymentMethod;
  clientIp?: string;
  idempotencyKey?: string;
}): Promise<{ transaction: ReturnType<typeof serializePaymentTransaction>; gatewayUrl: string }> {
  const { order, paymentMethod, clientIp, idempotencyKey } = params;
  const provider = resolveProviderForMethod(paymentMethod);
  const tranId = `TXN-${order.orderNumber}-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + env.PAYMENT_TIMEOUT_MINUTES * 60_000);

  const tx = await PaymentTransactionModel.create({
    orderId: order._id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    provider,
    paymentMethod,
    transactionId: tranId,
    idempotencyKey,
    amount: order.total,
    requestedAmount: order.total,
    currency: 'BDT',
    status: 'initiated',
    initiatedAt: new Date(),
    expiresAt,
  });

  let gatewayResponseReceived = false;
  let gatewayRequestStarted = false;
  try {
    const activated = await OrderModel.updateOne(
      { _id: order._id, paymentStatus: { $ne: 'paid' } },
      {
        $set: { activePaymentTransactionId: tx._id, paymentStatus: 'initiated' },
      },
    );
    if (activated.matchedCount !== 1) {
      throw new AppError(409, 'PAYMENT_ALREADY_SETTLED', 'This order has already been paid.');
    }

    order.activePaymentTransactionId = tx._id;
    order.paymentStatus = 'initiated';

    gatewayRequestStarted = true;
    const gateway = await dispatchGatewaySession({
      orderNumber: order.orderNumber,
      transactionId: tranId,
      amount: order.total,
      paymentMethod,
      customerName: order.shippingAddress?.recipientName || order.customerName,
      customerEmail: order.shippingAddress?.email || order.customerEmail,
      customerPhone: order.shippingAddress?.phone || order.customerPhone,
      clientIp,
      shippingAddress: order.shippingAddress,
    });

    gatewayResponseReceived = true;
    tx.gatewayPaymentId = gateway.gatewayPaymentId;
    tx.gatewaySessionKey = gateway.gatewaySessionKey;
    tx.gatewayUrl = gateway.gatewayUrl;
    tx.rawPayload = redactGatewayPayload(gateway.raw);
    await tx.save();

    await writePaymentSystemLog('info', `Initiated ${provider} payment session for ${order.orderNumber}`, {
      orderNumber: order.orderNumber,
      transactionId: tranId,
      provider,
      paymentMethod,
      amount: order.total,
      gatewayPaymentId: gateway.gatewayPaymentId,
    });

    return {
      transaction: serializePaymentTransaction(tx.toObject()),
      gatewayUrl: gateway.gatewayUrl,
    };
  } catch (err) {
    const definiteConfigurationFailure =
      err instanceof AppError && err.code === 'PAYMENT_GATEWAY_UNCONFIGURED';
    const outcomeUncertain = gatewayResponseReceived || (gatewayRequestStarted && !definiteConfigurationFailure);
    tx.status = outcomeUncertain ? 'pending' : 'failed';
    tx.reconciliationRequired = outcomeUncertain;
    tx.failedAt = outcomeUncertain ? null : new Date();
    tx.failureReason = outcomeUncertain
      ? 'Gateway initiation outcome is uncertain; reconcile with the provider before retrying.'
      : err instanceof Error
        ? err.message
        : 'Payment gateway initiation failed';
    await tx.save();
    if (!outcomeUncertain) {
      await OrderModel.updateOne(
        { _id: order._id, activePaymentTransactionId: tx._id, paymentStatus: { $ne: 'paid' } },
        { $set: { paymentStatus: 'failed' } },
      );
    }

    await writePaymentSystemLog('error', `Failed to initiate ${provider} payment for ${order.orderNumber}`, {
      orderNumber: order.orderNumber,
      transactionId: tranId,
      provider,
      error: tx.failureReason,
    });
    throw err;
  }
}

export async function releaseOrderReservationSafe(order: IOrder, reason: string) {
  for (const item of order.items) {
    const prodMeta = await ProductModel.findById(item.productId).select('manageInventory').lean().catch(() => null);
    if (prodMeta && prodMeta.manageInventory === false) continue;

    if (item.variantId) {
      await ProductModel.updateOne(
        {
          _id: item.productId,
          variants: { $elemMatch: { _id: item.variantId, reservedStock: { $gte: item.quantity } } },
        },
        { $inc: { 'variants.$.reservedStock': -item.quantity } },
      ).catch(() => undefined);
    } else {
      await ProductModel.updateOne(
        { _id: item.productId, reservedStock: { $gte: item.quantity } },
        { $inc: { reservedStock: -item.quantity } },
      ).catch(() => undefined);
    }
    await InventoryMovementModel.create({
      productId: item.productId,
      variantId: item.variantId || null,
      sku: item.sku,
      productName: item.name,
      type: 'release',
      delta: item.quantity,
      previousStockOnHand: 0,
      newStockOnHand: 0,
      previousReserved: item.quantity,
      newReserved: 0,
      reason,
      referenceId: order.orderNumber,
    }).catch(() => undefined);
  }
}

export async function reserveVariantStockAtomically(params: {
  productId: unknown;
  variantId: string;
  quantity: number;
  publishedOnly?: boolean;
}): Promise<boolean> {
  const filter: Record<string, unknown> = {
    _id: params.productId,
    variants: {
      $elemMatch: {
        _id: params.variantId,
        isActive: true,
      },
    },
    $expr: {
      $gt: [
        {
          $size: {
            $filter: {
              input: '$variants',
              as: 'variant',
              cond: {
                $and: [
                  { $eq: [{ $toString: '$$variant._id' }, params.variantId] },
                  { $ne: ['$$variant.isActive', false] },
                  {
                    $gte: [
                      {
                        $subtract: [
                          '$$variant.stockOnHand',
                          { $ifNull: ['$$variant.reservedStock', 0] },
                        ],
                      },
                      params.quantity,
                    ],
                  },
                ],
              },
            },
          },
        },
        0,
      ],
    },
  };
  if (params.publishedOnly !== false) {
    filter.status = 'published';
  }

  const result = await ProductModel.updateOne(
    filter,
    [
      {
        $set: {
          variants: {
            $map: {
              input: '$variants',
              as: 'variant',
              in: {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $toString: '$$variant._id' }, params.variantId] },
                      { $ne: ['$$variant.isActive', false] },
                      {
                        $gte: [
                          {
                            $subtract: [
                              '$$variant.stockOnHand',
                              { $ifNull: ['$$variant.reservedStock', 0] },
                            ],
                          },
                          params.quantity,
                        ],
                      },
                    ],
                  },
                  {
                    $mergeObjects: [
                      '$$variant',
                      {
                        reservedStock: {
                          $add: [{ $ifNull: ['$$variant.reservedStock', 0] }, params.quantity],
                        },
                      },
                    ],
                  },
                  '$$variant',
                ],
              },
            },
          },
        },
      },
    ] as never,
    { updatePipeline: true },
  );

  return result.modifiedCount === 1;
}

async function clearCartItemsForOrder(order: IOrder) {
  if (!order.userId) return;
  const userCart = await CartModel.findOne({ userId: order.userId });
  if (!userCart) return;

  const orderedKeys = new Set(
    order.items.map((item) => `${String(item.productId)}::${item.variantId ? String(item.variantId) : 'default'}`),
  );
  userCart.items = userCart.items.filter(
    (line: { productId: unknown; variantId?: unknown }) =>
      !orderedKeys.has(`${String(line.productId)}::${line.variantId ? String(line.variantId) : 'default'}`),
  );
  userCart.couponCode = null;
  await userCart.save();
}

async function getLatestPaymentAttemptId(orderId: unknown): Promise<string> {
  const latest = await PaymentTransactionModel.findOne({ orderId })
    .sort({ createdAt: -1 })
    .select('_id')
    .lean();
  return latest?._id ? String(latest._id) : '';
}

export async function markPaymentFailedOrCancelled(params: {
  tranId?: string;
  gatewayPaymentId?: string;
  outcome: 'failed' | 'cancelled' | 'expired';
  reason: string;
  source: string;
  payload?: Record<string, unknown>;
}): Promise<{ status: 'failed' | 'cancelled' | 'expired' | 'already_paid' | 'not_found'; orderId?: string; orderNumber?: string }> {
  const query = params.tranId
    ? { transactionId: params.tranId }
    : params.gatewayPaymentId
      ? { gatewayPaymentId: params.gatewayPaymentId }
      : null;
  if (!query) return { status: 'not_found' };

  const tx = await PaymentTransactionModel.findOne(query);
  if (!tx) return { status: 'not_found' };

  if (tx.status === 'paid' || tx.status === 'refunded' || tx.status === 'partially_refunded') {
    return { status: 'already_paid', orderId: String(tx.orderId), orderNumber: tx.orderNumber };
  }

  const now = new Date();
  const prevStatus = tx.status;
  tx.status = params.outcome;
  tx.processingLockAt = null;
  tx.reconciliationRequired = false;
  tx.failureReason = params.reason;
  if (params.outcome === 'cancelled') tx.cancelledAt = now;
  else tx.failedAt = now;
  if (params.payload) {
    tx.rawPayload = redactGatewayPayload(params.payload);
  }
  tx.webhookEvents = tx.webhookEvents || [];
  tx.webhookEvents.push({
    eventId: `evt-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    source: params.source,
    status: params.outcome,
    receivedAt: now,
    verified: true,
    error: params.reason,
  });
  await tx.save();

  const order = await OrderModel.findById(tx.orderId);
  if (order) {
    const activeTransactionId = order.activePaymentTransactionId
      ? String(order.activePaymentTransactionId)
      : await getLatestPaymentAttemptId(tx.orderId);
    if (activeTransactionId && activeTransactionId !== String(tx._id)) {
      await writePaymentSystemLog('warn', 'Ignored failure from a superseded payment attempt', {
        orderNumber: order.orderNumber,
        transactionId: tx.transactionId,
        activeTransactionId,
        source: params.source,
      });
      return { status: params.outcome, orderId: String(order._id), orderNumber: order.orderNumber };
    }

    const orderFence: Record<string, unknown> = {
      _id: order._id,
      paymentStatus: { $ne: 'paid' },
    };
    if (activeTransactionId) {
      orderFence.activePaymentTransactionId = order.activePaymentTransactionId || null;
    } else {
      orderFence.$or = [
        { activePaymentTransactionId: null },
        { activePaymentTransactionId: { $exists: false } },
      ];
    }

    if (order.orderStatus === 'pending') {
      const changed = await OrderModel.updateOne(
        { ...orderFence, orderStatus: 'pending' },
        {
          $set: {
            paymentStatus: params.outcome,
            orderStatus: 'cancelled',
            fulfillmentStatus: 'cancelled',
            cancellationReason: params.reason,
          },
          $push: {
            statusHistory: {
              fromStatus: 'pending',
              toStatus: 'cancelled',
              actorName: 'Payment Gateway',
              reason: params.reason,
              timestamp: now,
            },
          },
        },
      );
      if (changed.modifiedCount === 1) {
        order.paymentStatus = params.outcome;
        order.orderStatus = 'cancelled';
        order.fulfillmentStatus = 'cancelled';
        order.cancellationReason = params.reason;
        order.statusHistory.push({
          fromStatus: 'pending',
          toStatus: 'cancelled',
          actorName: 'Payment Gateway',
          reason: params.reason,
          timestamp: now,
        });
        if (['initiated', 'pending', 'authorized'].includes(prevStatus)) {
          await releaseOrderReservationSafe(order, params.reason);
        }
      }
    } else if (order.paymentStatus !== 'paid') {
      const changed = await OrderModel.updateOne(orderFence, { $set: { paymentStatus: params.outcome } });
      if (changed.modifiedCount === 1) order.paymentStatus = params.outcome;
    }

    await writePaymentSystemLog('warn', `Payment ${params.outcome} for order ${order.orderNumber}`, {
      orderNumber: order.orderNumber,
      transactionId: tx.transactionId,
      provider: tx.provider,
      reason: params.reason,
    });

    return { status: params.outcome, orderId: String(order._id), orderNumber: order.orderNumber };
  }

  return { status: params.outcome };
}

export async function reReserveOrderStockOrThrow(order: IOrder) {
  const reReserved: Array<{ productId: string; variantId?: string | null; quantity: number; sku: string; name: string }> = [];
  try {
    for (const item of order.items) {
      const prod = await ProductModel.findOne({ _id: item.productId, status: 'published' });
      if (!prod) {
        throw new AppError(409, 'PRODUCT_UNAVAILABLE', `${item.name} is no longer available for purchase.`);
      }
      const skipLock = prod.manageInventory === false || Boolean(prod.allowBackorder);
      if (item.variantId) {
        if (!skipLock) {
          const variant = prod.variants.find(
            (x: { _id: unknown; isActive?: boolean }) => String(x._id) === item.variantId && x.isActive !== false,
          );
          if (!variant) throw new AppError(409, 'VARIANT_NOT_FOUND', `${item.name} variant is unavailable.`);
          const reserved = await reserveVariantStockAtomically({
            productId: prod._id,
            variantId: item.variantId,
            quantity: item.quantity,
          });
          if (!reserved) throw new AppError(409, 'INSUFFICIENT_STOCK', `Insufficient stock for ${item.name} to confirm order.`);
        } else if (prod.manageInventory !== false) {
          await ProductModel.updateOne(
            { _id: prod._id, 'variants._id': item.variantId },
            { $inc: { 'variants.$.reservedStock': item.quantity } },
          );
        }
      } else if (!skipLock) {
        const resProd = await ProductModel.findOneAndUpdate(
          {
            _id: prod._id,
            status: 'published',
            $expr: { $gte: [{ $subtract: ['$stockOnHand', '$reservedStock'] }, item.quantity] },
          },
          { $inc: { reservedStock: item.quantity } },
        );
        if (!resProd) throw new AppError(409, 'INSUFFICIENT_STOCK', `Insufficient stock for ${item.name} to confirm order.`);
      } else if (prod.manageInventory !== false) {
        await ProductModel.updateOne({ _id: prod._id }, { $inc: { reservedStock: item.quantity } });
      }

      if (prod.manageInventory !== false) {
        reReserved.push({
          productId: String(item.productId),
          variantId: item.variantId || null,
          quantity: item.quantity,
          sku: item.sku,
          name: item.name,
        });
      }
    }
  } catch (err) {
    for (const r of reReserved) {
      if (r.variantId) {
        await ProductModel.updateOne(
          { _id: r.productId, 'variants._id': r.variantId },
          { $inc: { 'variants.$.reservedStock': -r.quantity } },
        ).catch(() => undefined);
      } else {
        await ProductModel.updateOne({ _id: r.productId }, { $inc: { reservedStock: -r.quantity } }).catch(() => undefined);
      }
    }
    throw err;
  }
}

export async function verifyAndFinalizePayment(params: {
  provider: PaymentProvider;
  tranId?: string;
  valId?: string;
  paymentId?: string;
  paymentRefId?: string;
  callbackStatus?: string;
  source: 'callback' | 'webhook' | 'ipn' | 'reconcile' | 'poll';
  payload?: Record<string, unknown>;
}): Promise<{
  status: 'paid' | 'already_paid' | 'pending' | 'failed' | 'cancelled' | 'not_found';
  orderId?: string;
  orderNumber?: string;
  transactionId?: string;
  reason?: string;
}> {
  const lookup = params.tranId
    ? { transactionId: params.tranId }
    : params.paymentId || params.paymentRefId
      ? { gatewayPaymentId: params.paymentId || params.paymentRefId }
      : null;

  if (!lookup) return { status: 'not_found' };

  const tx = await PaymentTransactionModel.findOne(lookup);
  if (!tx) return { status: 'not_found' };

  if (tx.status === 'paid' || tx.status === 'refunded' || tx.status === 'partially_refunded') {
    return {
      status: 'already_paid',
      orderId: String(tx.orderId),
      orderNumber: tx.orderNumber,
      transactionId: tx.transactionId,
    };
  }

  const order = await OrderModel.findById(tx.orderId);
  if (!order) return { status: 'not_found' };

  // Atomic concurrency lease lock to avoid race between simultaneous IPN, webhook & browser redirect
  const lockNow = new Date();
  const lockExpiryCutoff = new Date(lockNow.getTime() - 30_000);
  const lockDoc = await PaymentTransactionModel.findOneAndUpdate(
    {
      _id: tx._id,
      status: { $in: ['initiated', 'pending', 'authorized', 'expired', 'failed', 'cancelled'] },
      $or: [
        { processingLockAt: null },
        { processingLockAt: { $exists: false } },
        { processingLockAt: { $lt: lockExpiryCutoff } },
      ],
    },
    { $set: { status: 'pending', processingLockAt: lockNow } },
    { new: true },
  );
  if (!lockDoc) {
    const latest = await PaymentTransactionModel.findById(tx._id).lean();
    if (latest?.status === 'paid' || latest?.status === 'refunded' || latest?.status === 'partially_refunded') {
      return {
        status: 'already_paid',
        orderId: String(tx.orderId),
        orderNumber: tx.orderNumber,
        transactionId: tx.transactionId,
      };
    }
    if (latest?.status === 'cancelled') {
      return {
        status: 'cancelled',
        orderId: String(tx.orderId),
        orderNumber: tx.orderNumber,
        transactionId: tx.transactionId,
      };
    }
    if (latest?.status === 'pending' || latest?.status === 'initiated' || latest?.status === 'authorized') {
      return {
        status: 'pending',
        orderId: String(tx.orderId),
        orderNumber: tx.orderNumber,
        transactionId: tx.transactionId,
      };
    }
    return {
      status: 'failed',
      orderId: String(tx.orderId),
      orderNumber: tx.orderNumber,
      transactionId: tx.transactionId,
    };
  }

  const expectedAmount = Number(tx.requestedAmount || tx.amount);
  let verification: GatewayVerifyOutput;

  try {
    if (tx.provider === 'bkash') {
      const paymentID = params.paymentId || tx.gatewayPaymentId || String(params.payload?.paymentID || '');
      if (params.source === 'callback') {
        verification = await executeAndVerifyBkashPayment({
          transactionId: tx.transactionId,
          expectedAmount,
          expectedCurrency: tx.currency || 'BDT',
          gatewayPaymentId: paymentID,
          payload: params.payload,
        });
      } else {
        verification = await queryBkashPaymentStatus({
          transactionId: tx.transactionId,
          expectedAmount,
          expectedCurrency: tx.currency || 'BDT',
          gatewayPaymentId: paymentID,
          payload: params.payload,
        });
        if (!verification.verified && verification.status === 'authorized') {
          verification = await executeAndVerifyBkashPayment({
            transactionId: tx.transactionId,
            expectedAmount,
            expectedCurrency: tx.currency || 'BDT',
            gatewayPaymentId: paymentID,
            payload: params.payload,
          });
        }
      }
    } else if (tx.provider === 'nagad') {
      verification = await verifyNagadPayment({
        transactionId: tx.transactionId,
        expectedAmount,
        expectedCurrency: tx.currency || 'BDT',
        paymentRefId: params.paymentRefId || tx.gatewayPaymentId,
        payload: params.payload,
      });
    } else {
      const valId = params.valId || String(params.payload?.val_id || '');
      verification = valId
        ? await verifySslCommerzPayment({
            transactionId: tx.transactionId,
            expectedAmount,
            expectedCurrency: tx.currency || 'BDT',
            gatewayValidationId: valId,
            payload: params.payload,
          })
        : await querySslCommerzByTranId(tx.transactionId, expectedAmount, tx.currency || 'BDT');
    }
  } catch (err) {
    verification = {
      verified: false,
      status: 'pending',
      failureReason: err instanceof Error ? err.message : 'Gateway verification error.',
      raw: params.payload ? redactGatewayPayload(params.payload) : undefined,
    };
  }

  const now = new Date();
  const evtId = `evt-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;

  if (!verification.verified) {
    const mismatchEvidence =
      verification.verifiedAmount !== undefined &&
      /amount|currency|merchant|invoice|reference|orderid|transaction id mismatch/i.test(verification.failureReason || '');
    if (mismatchEvidence) {
      lockDoc.status = 'pending';
      lockDoc.processingLockAt = null;
      lockDoc.reconciliationRequired = true;
      lockDoc.verifiedAmount = verification.verifiedAmount;
      lockDoc.gatewayPaymentId = verification.gatewayPaymentId || lockDoc.gatewayPaymentId;
      lockDoc.gatewayTransactionId = verification.gatewayTransactionId || lockDoc.gatewayTransactionId;
      lockDoc.gatewayValidationId = verification.gatewayValidationId || lockDoc.gatewayValidationId;
      lockDoc.bankTransactionId = verification.bankTransactionId || lockDoc.bankTransactionId;
      lockDoc.failureReason = verification.failureReason;
      lockDoc.rawPayload = redactGatewayPayload(verification.raw || params.payload);
      lockDoc.webhookEvents.push({
        eventId: evtId,
        source: params.source,
        status: 'reconciliation_required',
        receivedAt: now,
        verified: false,
        error: verification.failureReason,
      });
      await lockDoc.save();
      await writePaymentSystemLog('error', 'Gateway reported a transaction that requires payment reconciliation', {
        orderNumber: order.orderNumber,
        transactionId: tx.transactionId,
        provider: tx.provider,
        failureReason: verification.failureReason,
      });
      return {
        status: 'pending',
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        transactionId: tx.transactionId,
        reason: verification.failureReason,
      };
    }

    if (verification.status === 'pending' || verification.status === 'authorized') {
      lockDoc.status = verification.status;
      lockDoc.processingLockAt = null;
      lockDoc.failureReason = verification.failureReason;
      lockDoc.webhookEvents.push({
        eventId: evtId,
        source: params.source,
        status: verification.status,
        receivedAt: now,
        verified: false,
        error: verification.failureReason,
      });
      await lockDoc.save();
      return {
        status: 'pending',
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        transactionId: tx.transactionId,
        reason: verification.failureReason,
      };
    }

    const finalOutcome = verification.status === 'cancelled' ? 'cancelled' : 'failed';
    const failRes = await markPaymentFailedOrCancelled({
      tranId: tx.transactionId,
      outcome: finalOutcome,
      reason: verification.failureReason || 'Gateway verification failed or amount mismatch.',
      source: params.source,
      payload: verification.raw || params.payload,
    });
    return {
      ...failRes,
      status: finalOutcome,
      transactionId: tx.transactionId,
      reason: verification.failureReason,
    };
  }

  // Anti-replay check: ensure gatewayTransactionId or gatewayValidationId is not already claimed by another paid tx
  const dupOrFilters: Array<Record<string, unknown>> = [];
  if (verification.gatewayTransactionId) {
    dupOrFilters.push({ gatewayTransactionId: verification.gatewayTransactionId });
  }
  if (verification.gatewayValidationId) {
    dupOrFilters.push({ gatewayValidationId: verification.gatewayValidationId });
  }
  if (dupOrFilters.length > 0) {
    const duplicateClaim = await PaymentTransactionModel.findOne({
      _id: { $ne: lockDoc._id },
      status: { $in: ['paid', 'refund_pending', 'partially_refunded', 'refunded'] },
      $or: dupOrFilters,
    }).lean();
    if (duplicateClaim) {
      const replayReason = 'Duplicate gateway transaction/validation reference detected (replay blocked).';
      await markPaymentFailedOrCancelled({
        tranId: tx.transactionId,
        outcome: 'failed',
        reason: replayReason,
        source: params.source,
        payload: verification.raw,
      });
      await writePaymentSystemLog('error', replayReason, {
        transactionId: tx.transactionId,
        existingTransactionId: duplicateClaim.transactionId,
      });
      return {
        status: 'failed',
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        transactionId: tx.transactionId,
        reason: replayReason,
      };
    }
  }

  const expectedCurrency = tx.currency || 'BDT';
  if (
    verification.verifiedAmount === undefined ||
    !Number.isFinite(verification.verifiedAmount) ||
    verification.currency !== expectedCurrency ||
    verification.tranId !== tx.transactionId
  ) {
    lockDoc.status = 'pending';
    lockDoc.processingLockAt = null;
    lockDoc.reconciliationRequired = true;
    lockDoc.failureReason = 'Gateway verification omitted or mismatched required amount, currency, or invoice reference.';
    lockDoc.rawPayload = redactGatewayPayload(verification.raw || params.payload);
    lockDoc.webhookEvents.push({
      eventId: evtId,
      source: params.source,
      status: 'reconciliation_required',
      receivedAt: now,
      verified: false,
      error: lockDoc.failureReason,
    });
    await lockDoc.save();
    return {
      status: 'pending',
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      transactionId: tx.transactionId,
      reason: lockDoc.failureReason,
    };
  }

  if (!amountsMatch(expectedAmount, verification.verifiedAmount)) {
    const mismatchReason = `Verified amount (${verification.verifiedAmount}) does not match order total (${expectedAmount}).`;
    lockDoc.status = 'paid';
    lockDoc.processingLockAt = null;
    lockDoc.verifiedAmount = verification.verifiedAmount;
    lockDoc.gatewayPaymentId = verification.gatewayPaymentId || lockDoc.gatewayPaymentId;
    lockDoc.gatewayTransactionId = verification.gatewayTransactionId || lockDoc.gatewayTransactionId;
    lockDoc.gatewayValidationId = verification.gatewayValidationId || lockDoc.gatewayValidationId;
    lockDoc.bankTransactionId = verification.bankTransactionId || lockDoc.bankTransactionId;
    lockDoc.verifiedAt = now;
    lockDoc.paidAt = now;
    lockDoc.reconciliationRequired = true;
    lockDoc.failureReason = mismatchReason;
    lockDoc.rawPayload = redactGatewayPayload(verification.raw || params.payload);
    lockDoc.webhookEvents.push({
      eventId: evtId,
      source: params.source,
      status: 'reconciliation_required',
      receivedAt: now,
      verified: true,
      error: mismatchReason,
    });
    await lockDoc.save();
    return {
      status: 'pending',
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      transactionId: tx.transactionId,
      reason: mismatchReason,
    };
  }

  const activeTransactionId = order.activePaymentTransactionId
    ? String(order.activePaymentTransactionId)
    : await getLatestPaymentAttemptId(tx.orderId);
  if (order.paymentStatus === 'paid' && activeTransactionId === String(lockDoc._id)) {
    lockDoc.status = 'paid';
    lockDoc.processingLockAt = null;
    lockDoc.verifiedAmount = verification.verifiedAmount;
    lockDoc.gatewayPaymentId = verification.gatewayPaymentId || lockDoc.gatewayPaymentId;
    lockDoc.gatewayTransactionId = verification.gatewayTransactionId || lockDoc.gatewayTransactionId;
    lockDoc.gatewayValidationId = verification.gatewayValidationId || lockDoc.gatewayValidationId;
    lockDoc.bankTransactionId = verification.bankTransactionId || lockDoc.bankTransactionId;
    lockDoc.verifiedAt = now;
    lockDoc.paidAt = lockDoc.paidAt || now;
    lockDoc.reconciliationRequired = false;
    await lockDoc.save();
    return {
      status: 'already_paid',
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      transactionId: tx.transactionId,
    };
  }
  if (
    (activeTransactionId && activeTransactionId !== String(lockDoc._id)) ||
    (order.paymentStatus === 'paid' && activeTransactionId !== String(lockDoc._id))
  ) {
    lockDoc.status = 'paid';
    lockDoc.processingLockAt = null;
    lockDoc.verifiedAmount = verification.verifiedAmount;
    lockDoc.gatewayPaymentId = verification.gatewayPaymentId || lockDoc.gatewayPaymentId;
    lockDoc.gatewayTransactionId = verification.gatewayTransactionId || lockDoc.gatewayTransactionId;
    lockDoc.gatewayValidationId = verification.gatewayValidationId || lockDoc.gatewayValidationId;
    lockDoc.bankTransactionId = verification.bankTransactionId || lockDoc.bankTransactionId;
    lockDoc.verifiedAt = now;
    lockDoc.paidAt = now;
    lockDoc.duplicatePayment = true;
    lockDoc.duplicateOfTransactionId = activeTransactionId || undefined;
    lockDoc.reconciliationRequired = true;
    lockDoc.failureReason = 'Verified gateway charge belongs to a superseded payment attempt and was not applied to the order.';
    lockDoc.rawPayload = redactGatewayPayload(verification.raw || params.payload);
    lockDoc.webhookEvents.push({
      eventId: evtId,
      source: params.source,
      status: 'duplicate_paid',
      receivedAt: now,
      verified: true,
      error: lockDoc.failureReason,
    });
    await lockDoc.save();
    await writePaymentSystemLog('error', lockDoc.failureReason, {
      orderNumber: order.orderNumber,
      transactionId: tx.transactionId,
      activeTransactionId,
      gatewayTransactionId: lockDoc.gatewayTransactionId,
    });
    return {
      status: order.paymentStatus === 'paid' ? 'already_paid' : 'pending',
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      transactionId: tx.transactionId,
      reason: lockDoc.failureReason,
    };
  }

  // If a delayed verified payment arrives for a previously cancelled/expired order, attempt stock re-reservation
  if (order.orderStatus === 'cancelled') {
    try {
      await reReserveOrderStockOrThrow(order);
    } catch (stockErr) {
      const refundReason =
        stockErr instanceof Error
          ? `Verified delayed payment received after order cancelled, but stock unavailable (${stockErr.message}). Marked refund_pending.`
          : 'Verified delayed payment received after order cancelled and stock exhausted. Marked refund_pending.';
      lockDoc.status = 'refund_pending';
      lockDoc.processingLockAt = null;
      lockDoc.verifiedAmount = verification.verifiedAmount ?? expectedAmount;
      lockDoc.gatewayPaymentId = verification.gatewayPaymentId || lockDoc.gatewayPaymentId;
      lockDoc.gatewayTransactionId = verification.gatewayTransactionId || lockDoc.gatewayTransactionId;
      lockDoc.gatewayValidationId = verification.gatewayValidationId || lockDoc.gatewayValidationId;
      lockDoc.bankTransactionId = verification.bankTransactionId || lockDoc.bankTransactionId;
      lockDoc.verifiedAt = now;
      lockDoc.paidAt = now;
      lockDoc.reconciliationRequired = true;
      lockDoc.failureReason = refundReason;
      lockDoc.rawPayload = redactGatewayPayload(verification.raw || params.payload);
      lockDoc.webhookEvents.push({
        eventId: evtId,
        source: params.source,
        status: 'refund_pending',
        receivedAt: now,
        verified: true,
        error: refundReason,
      });
      await lockDoc.save();

      order.paymentStatus = 'refund_pending';
      order.paidAt = now;
      order.staffNotes = order.staffNotes || [];
      order.staffNotes.push({
        note: refundReason,
        actorName: 'Payment Gateway',
        timestamp: now,
      });
      await order.save();

      await writePaymentSystemLog('error', refundReason, {
        orderNumber: order.orderNumber,
        transactionId: tx.transactionId,
        gatewayTransactionId: lockDoc.gatewayTransactionId,
      });

      return {
        status: 'failed',
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        transactionId: tx.transactionId,
        reason: refundReason,
      };
    }
  }

  const wasCancelled = order.orderStatus === 'cancelled';
  const shouldConfirm = order.orderStatus === 'pending' || wasCancelled;
  const orderUpdate: Record<string, unknown> = {
    paymentStatus: 'paid',
    paidAt: now,
  };
  if (shouldConfirm) {
    orderUpdate.orderStatus = 'confirmed';
    orderUpdate.fulfillmentStatus = 'unfulfilled';
    orderUpdate.cancellationReason = null;
  }
  const orderFilter: Record<string, unknown> = {
    _id: order._id,
    paymentStatus: { $ne: 'paid' },
  };
  if (activeTransactionId) {
    orderFilter.activePaymentTransactionId = lockDoc._id;
  } else {
    orderFilter.$or = [
      { activePaymentTransactionId: null },
      { activePaymentTransactionId: { $exists: false } },
    ];
  }
  const orderUpdateOperation: Record<string, unknown> = { $set: orderUpdate };
  if (shouldConfirm) {
    orderUpdateOperation.$push = {
      statusHistory: {
        fromStatus: order.orderStatus,
        toStatus: 'confirmed',
        actorName: 'Payment Gateway',
        reason: `Verified ${tx.provider.toUpperCase()} payment ${verification.gatewayTransactionId || tx.transactionId}`,
        timestamp: now,
      },
    };
  }
  const settlement = await OrderModel.updateOne(orderFilter, orderUpdateOperation);
  if (settlement.modifiedCount !== 1) {
    lockDoc.status = 'paid';
    lockDoc.processingLockAt = null;
    lockDoc.verifiedAmount = verification.verifiedAmount;
    lockDoc.gatewayPaymentId = verification.gatewayPaymentId || lockDoc.gatewayPaymentId;
    lockDoc.gatewayTransactionId = verification.gatewayTransactionId || lockDoc.gatewayTransactionId;
    lockDoc.gatewayValidationId = verification.gatewayValidationId || lockDoc.gatewayValidationId;
    lockDoc.bankTransactionId = verification.bankTransactionId || lockDoc.bankTransactionId;
    lockDoc.verifiedAt = now;
    lockDoc.paidAt = now;
    lockDoc.duplicatePayment = true;
    lockDoc.duplicateOfTransactionId = activeTransactionId || undefined;
    lockDoc.reconciliationRequired = true;
    lockDoc.failureReason = 'Gateway charge verified, but the order payment fence rejected settlement.';
    lockDoc.rawPayload = redactGatewayPayload(verification.raw || params.payload);
    lockDoc.webhookEvents.push({
      eventId: evtId,
      source: params.source,
      status: 'duplicate_paid',
      receivedAt: now,
      verified: true,
      error: lockDoc.failureReason,
    });
    await lockDoc.save();
    await writePaymentSystemLog('error', lockDoc.failureReason, {
      orderNumber: order.orderNumber,
      transactionId: tx.transactionId,
      activeTransactionId,
      gatewayTransactionId: lockDoc.gatewayTransactionId,
    });
    return {
      status: 'already_paid',
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      transactionId: tx.transactionId,
      reason: lockDoc.failureReason,
    };
  }

  if (shouldConfirm) {
    order.orderStatus = 'confirmed';
    order.fulfillmentStatus = 'unfulfilled';
    order.cancellationReason = undefined;
    order.statusHistory.push({
      fromStatus: wasCancelled ? 'cancelled' : 'pending',
      toStatus: 'confirmed',
      actorName: 'Payment Gateway',
      reason: `Verified ${tx.provider.toUpperCase()} payment ${verification.gatewayTransactionId || tx.transactionId}`,
      timestamp: now,
    });
  }
  order.paymentStatus = 'paid';
  order.paidAt = now;

  lockDoc.status = 'paid';
  lockDoc.processingLockAt = null;
  lockDoc.verifiedAmount = verification.verifiedAmount;
  lockDoc.gatewayPaymentId = verification.gatewayPaymentId || lockDoc.gatewayPaymentId;
  lockDoc.gatewayTransactionId = verification.gatewayTransactionId || lockDoc.gatewayTransactionId;
  lockDoc.gatewayValidationId = verification.gatewayValidationId || lockDoc.gatewayValidationId;
  lockDoc.bankTransactionId = verification.bankTransactionId || lockDoc.bankTransactionId;
  lockDoc.verifiedAt = now;
  lockDoc.paidAt = now;
  lockDoc.reconciliationRequired = false;
  lockDoc.duplicatePayment = false;
  lockDoc.duplicateOfTransactionId = undefined;
  lockDoc.failureReason = undefined;
  lockDoc.rawPayload = redactGatewayPayload(verification.raw || params.payload);
  lockDoc.webhookEvents.push({
    eventId: evtId,
    source: params.source,
    status: 'paid',
    receivedAt: now,
    verified: true,
  });
  await lockDoc.save();

  // Clear purchased items from cart strictly AFTER verified payment
  await clearCartItemsForOrder(order).catch(() => undefined);

  await writePaymentSystemLog('info', `Verified ${tx.provider} payment for order ${order.orderNumber}`, {
    orderNumber: order.orderNumber,
    transactionId: tx.transactionId,
    gatewayTransactionId: lockDoc.gatewayTransactionId,
    verifiedAmount: lockDoc.verifiedAmount,
    source: params.source,
  });

  await sendTransactionalEmail({
    to: order.customerEmail,
    template: 'payment_confirmed',
    subject: `Payment Received for Order ${order.orderNumber}`,
    html: `<p>Your ${tx.provider.toUpperCase()} payment of <strong>৳${order.total.toLocaleString()}</strong> for order <strong>${order.orderNumber}</strong> has been verified.</p><p>Transaction Reference: <strong>${lockDoc.gatewayTransactionId || lockDoc.transactionId}</strong></p>`,
  }).catch(() => undefined);

  return {
    status: 'paid',
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    transactionId: tx.transactionId,
  };
}

export async function retryOrderPaymentForCustomer(params: {
  orderId: string;
  userId: unknown;
  paymentMethod?: PaymentMethod;
  clientIp?: string;
}) {
  if (!mongoose.isValidObjectId(params.orderId)) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  }

  const order = await OrderModel.findOne({ _id: params.orderId, userId: params.userId });
  if (!order) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  }

  const targetMethod = params.paymentMethod || order.paymentMethod;
  if (targetMethod === 'cod') {
    throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'Cannot initiate online gateway session for Cash on Delivery.');
  }

  if (
    !canRetryOrderPayment({
      orderStatus: order.orderStatus,
      paymentMethod: targetMethod,
      paymentStatus: order.paymentStatus,
    })
  ) {
    throw new AppError(
      400,
      'PAYMENT_RETRY_NOT_ELIGIBLE',
      `Order ${order.orderNumber} is not eligible for online payment retry (status: ${order.orderStatus}, payment: ${order.paymentStatus}).`,
    );
  }

  const cmsCfg = await HomepageConfigModel.findOne({ key: 'main' }).lean();
  const pm = cmsCfg?.paymentMethods;
  if (pm) {
    const channelDisabled =
      (targetMethod === 'sslcommerz' && pm.sslcommerzEnabled === false) ||
      (targetMethod === 'bkash' && pm.bkashEnabled === false) ||
      (targetMethod === 'nagad' && pm.nagadEnabled === false) ||
      (targetMethod === 'card' && pm.cardEnabled === false);
    if (channelDisabled) {
      throw new AppError(400, 'PAYMENT_METHOD_DISABLED', 'Selected payment method is currently disabled.');
    }
  }

  if (!isPaymentMethodConfigured(targetMethod)) {
    throw new AppError(503, 'PAYMENT_GATEWAY_UNCONFIGURED', getUnconfiguredMethodMessage(targetMethod));
  }

  // If the order had previously been auto-cancelled by a failed/cancelled attempt, verify & re-reserve stock atomically
  if (order.orderStatus === 'cancelled') {
    await reReserveOrderStockOrThrow(order);
    order.orderStatus = 'pending';
    order.fulfillmentStatus = 'unfulfilled';
    order.cancellationReason = undefined;
    order.statusHistory.push({
      fromStatus: 'cancelled',
      toStatus: 'pending',
      actorName: order.customerName,
      reason: `Customer initiated payment retry (${targetMethod.toUpperCase()})`,
      timestamp: new Date(),
    });
  }

  order.paymentMethod = targetMethod;
  order.paymentStatus = 'initiated';
  await order.save();

  const { transaction, gatewayUrl } = await createAndInitiatePaymentTransaction({
    order,
    paymentMethod: targetMethod,
    clientIp: params.clientIp,
  });

  return {
    order: { ...order.toObject(), id: String(order._id) },
    transaction,
    gatewayUrl,
  };
}

export async function queryPaymentStatusForUser(params: { transactionId: string; userId: unknown }) {
  const tx = await PaymentTransactionModel.findOne({ transactionId: params.transactionId }).lean();
  if (!tx) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Payment transaction not found.');

  const order = await OrderModel.findOne({ _id: tx.orderId, userId: params.userId }).lean();
  if (!order) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Payment transaction not found.');

  if (['initiated', 'pending', 'authorized', 'expired', 'failed', 'cancelled'].includes(tx.status) && tx.provider !== 'cod') {
    await verifyAndFinalizePayment({
      provider: tx.provider as PaymentProvider,
      tranId: tx.transactionId,
      paymentId: tx.gatewayPaymentId,
      paymentRefId: tx.gatewayPaymentId,
      source: 'poll',
    });
  }

  const [freshTx, freshOrder] = await Promise.all([
    PaymentTransactionModel.findById(tx._id).lean(),
    OrderModel.findById(order._id).lean(),
  ]);

  return {
    transaction: freshTx ? serializePaymentTransaction(freshTx as unknown as Record<string, unknown>) : null,
    order: freshOrder ? { ...freshOrder, id: String(freshOrder._id) } : null,
  };
}

export async function reconcilePaymentTransactionAdmin(params: {
  idOrTranId: string;
  actor?: Parameters<typeof recordAuditLog>[0]['actor'];
}) {
  const query = mongoose.isValidObjectId(params.idOrTranId)
    ? { _id: params.idOrTranId }
    : { transactionId: params.idOrTranId };
  const tx = await PaymentTransactionModel.findOne(query);
  if (!tx) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Payment transaction not found.');

  if (tx.provider === 'cod') {
    tx.reconciledAt = new Date();
    tx.reconciliationAttempts = (tx.reconciliationAttempts || 0) + 1;
    await tx.save();
    return { transaction: serializePaymentTransaction(tx.toObject()), outcome: tx.status };
  }

  if (tx.status === 'paid' || tx.status === 'refunded' || tx.status === 'partially_refunded') {
    tx.reconciledAt = new Date();
    tx.reconciliationAttempts = (tx.reconciliationAttempts || 0) + 1;
    await tx.save();
    return { transaction: serializePaymentTransaction(tx.toObject()), outcome: tx.status };
  }

  const verifyResult = await verifyAndFinalizePayment({
    provider: tx.provider as PaymentProvider,
    tranId: tx.transactionId,
    paymentId: tx.gatewayPaymentId,
    paymentRefId: tx.gatewayPaymentId,
    valId: tx.gatewayValidationId,
    source: 'reconcile',
  });

  const updated = await PaymentTransactionModel.findById(tx._id);
  if (updated) {
    // Keep an old pending transaction recoverable when the gateway outcome is still uncertain.
    if (
      verifyResult.status === 'pending' &&
      updated.expiresAt &&
      updated.expiresAt.getTime() < Date.now()
    ) {
      updated.reconciliationRequired = true;
      updated.failureReason =
        'Payment session exceeded its expiry window, but the provider still reports an uncertain outcome.';
      await updated.save();
      await writePaymentSystemLog('warn', updated.failureReason, {
        orderNumber: updated.orderNumber,
        transactionId: updated.transactionId,
        provider: updated.provider,
      });
    }
    await PaymentTransactionModel.updateOne(
      { _id: updated._id },
      { $set: { reconciledAt: new Date() }, $inc: { reconciliationAttempts: 1 } },
    );
  }

  const finalTx = await PaymentTransactionModel.findById(tx._id).lean();
  if (params.actor) {
    await recordAuditLog({
      actor: params.actor,
      action: 'payment.reconcile',
      resourceType: 'PaymentTransaction',
      resourceId: tx.transactionId,
      summary: `Reconciled ${tx.provider} transaction ${tx.transactionId} (${verifyResult.status})`,
    });
  }

  return {
    transaction: finalTx ? serializePaymentTransaction(finalTx as unknown as Record<string, unknown>) : null,
    outcome: verifyResult.status,
  };
}

export async function reconcilePendingPaymentsAdmin(params: {
  actor?: Parameters<typeof recordAuditLog>[0]['actor'];
  limit?: number;
}) {
  const pending = await PaymentTransactionModel.find({
    status: { $in: ['initiated', 'pending', 'authorized'] },
    provider: { $ne: 'cod' },
  })
    .sort({ createdAt: 1 })
    .limit(Math.min(50, params.limit || 25));

  const results: Array<{ transactionId: string; status: string }> = [];
  for (const tx of pending) {
    try {
      const res = await reconcilePaymentTransactionAdmin({ idOrTranId: String(tx._id), actor: undefined });
      results.push({ transactionId: tx.transactionId, status: res.outcome });
    } catch (err) {
      results.push({
        transactionId: tx.transactionId,
        status: err instanceof Error ? err.message : 'error',
      });
    }
  }

  if (params.actor) {
    await recordAuditLog({
      actor: params.actor,
      action: 'payment.reconcile_batch',
      resourceType: 'PaymentTransaction',
      summary: `Batch-reconciled ${results.length} pending online transactions`,
      metadata: { results },
    });
  }

  return { count: results.length, results };
}

export async function refundPaymentTransactionAdmin(params: {
  idOrTranId: string;
  amount?: number;
  reason: string;
  actor: NonNullable<Parameters<typeof recordAuditLog>[0]['actor']>;
}) {
  const query = mongoose.isValidObjectId(params.idOrTranId)
    ? { _id: params.idOrTranId }
    : { transactionId: params.idOrTranId };
  const tx = await PaymentTransactionModel.findOne(query);
  if (!tx) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Payment transaction not found.');

  if (!canRefundPaymentTransaction({ status: tx.status, amount: tx.amount, refundedAmount: tx.refundedAmount })) {
    throw new AppError(
      400,
      'REFUND_NOT_ELIGIBLE',
      `Transaction ${tx.transactionId} in status "${tx.status}" has no refundable balance remaining.`,
    );
  }

  if (tx.provider !== 'bkash' && tx.provider !== 'sslcommerz') {
    throw new AppError(
      422,
      'GATEWAY_REFUND_UNSUPPORTED',
      `${tx.provider.toUpperCase()} refunds require a separately evidenced merchant-side settlement workflow, which is not enabled.`,
    );
  }

  const capturedAmount = Number(tx.verifiedAmount ?? tx.amount);
  const refundableBalance = computeRefundableBalance(capturedAmount, tx.refundedAmount || 0);
  const requestedAmount = params.amount === undefined ? refundableBalance : params.amount;
  const refundMinorUnits = Math.round(requestedAmount * 100);
  const refundableMinorUnits = Math.round(refundableBalance * 100);
  if (
    !Number.isFinite(requestedAmount) ||
    !Number.isSafeInteger(refundMinorUnits) ||
    Math.abs(requestedAmount * 100 - refundMinorUnits) > 1e-8 ||
    refundMinorUnits <= 0 ||
    refundMinorUnits > refundableMinorUnits
  ) {
    throw new AppError(
      400,
      'INVALID_REFUND_AMOUNT',
      `Refund amount must be between ৳1 and refundable balance ৳${refundableBalance.toLocaleString('en-IN')}.`,
    );
  }
  const refundAmount = refundMinorUnits / 100;

  const refundId = `RFD-${tx.orderNumber}-${crypto.randomUUID().toUpperCase()}`;
  const now = new Date();
  const previousRefundedAmount = Number(tx.refundedAmount || 0);
  const refundReservation = {
    refundId,
    amount: refundAmount,
    reason: params.reason,
    status: 'processing',
    requestedBy: params.actor._id as mongoose.Types.ObjectId,
    requestedByName: params.actor.name,
    createdAt: now,
  };
  const reserved = await PaymentTransactionModel.findOneAndUpdate(
    {
      _id: tx._id,
      status: tx.status,
      refundedAmount: previousRefundedAmount,
      $nor: [
        {
          refunds: {
            $elemMatch: { status: { $in: ['pending', 'processing', 'reconciliation_required'] } },
          },
        },
      ],
      amount: { $gte: capturedAmount },
    },
    {
      $push: { refunds: refundReservation },
      $set: { status: 'refund_pending' },
    },
    { new: true },
  );
  if (!reserved) {
    throw new AppError(409, 'REFUND_IN_PROGRESS', 'Refund balance changed or another refund requires reconciliation.');
  }

  const persistRefundOutcome = async (
    outcome: 'failed' | 'reconciliation_required',
    reason: string,
    gatewayResponse?: Record<string, unknown>,
  ) => {
    await PaymentTransactionModel.updateOne(
      { _id: tx._id, refunds: { $elemMatch: { refundId, status: 'processing' } } },
      {
        $set: {
          'refunds.$.status': outcome,
          'refunds.$.gatewayResponse': gatewayResponse,
          status: previousRefundedAmount > 0 ? 'partially_refunded' : 'paid',
          reconciliationRequired: outcome === 'reconciliation_required',
          failureReason: reason,
        },
      },
    );
  };

  let gatewayResult: GatewayRefundOutput;
  try {
    gatewayResult =
      tx.provider === 'bkash'
        ? await refundBkashPayment({
            transactionId: tx.transactionId,
            gatewayPaymentId: tx.gatewayPaymentId,
            gatewayTransactionId: tx.gatewayTransactionId || tx.bankTransactionId,
            amount: refundAmount,
            reason: params.reason,
            sku: tx.orderNumber,
          })
        : await refundSslCommerzPayment({
            transactionId: tx.transactionId,
            bankTransactionId: tx.bankTransactionId || tx.gatewayTransactionId,
            gatewayTransactionId: tx.gatewayTransactionId,
            amount: refundAmount,
            reason: params.reason,
          });
  } catch (err) {
    const reason = 'Gateway refund outcome is uncertain; reconcile with the provider before another refund.';
    await persistRefundOutcome('reconciliation_required', reason);
    await writePaymentSystemLog('error', reason, {
      transactionId: tx.transactionId,
      refundId,
      provider: tx.provider,
      error: err instanceof Error ? err.message : 'Unknown gateway refund error',
    });
    throw new AppError(502, 'REFUND_OUTCOME_UNCERTAIN', reason);
  }

  if (!gatewayResult.success) {
    await persistRefundOutcome('failed', gatewayResult.failureReason || 'Gateway rejected the refund.', gatewayResult.raw);
    throw new AppError(502, 'GATEWAY_REFUND_FAILED', gatewayResult.failureReason || 'Gateway refund failed.');
  }
  if (gatewayResult.status !== 'completed' || !gatewayResult.gatewayRefundId) {
    const reason = 'Gateway has not confirmed a completed refund with a provider reference.';
    await persistRefundOutcome('reconciliation_required', reason, gatewayResult.raw);
    throw new AppError(502, 'REFUND_OUTCOME_UNCERTAIN', reason);
  }

  const gatewayRefundId = gatewayResult.gatewayRefundId;
  const nextRefundedMinorUnits = Math.round(previousRefundedAmount * 100) + refundMinorUnits;
  const fullyRefunded = nextRefundedMinorUnits >= Math.round(capturedAmount * 100);
  const nextStatus: PaymentTransactionStatus = fullyRefunded ? 'refunded' : 'partially_refunded';
  const completedTx = await PaymentTransactionModel.findOneAndUpdate(
    {
      _id: tx._id,
      refundedAmount: previousRefundedAmount,
      refunds: { $elemMatch: { refundId, status: 'processing' } },
    },
    {
      $inc: { refundedAmount: refundAmount },
      $set: {
        status: nextStatus,
        reconciliationRequired: false,
        failureReason: null,
        'refunds.$.status': 'completed',
        'refunds.$.gatewayRefundId': gatewayResult.gatewayRefundId,
        'refunds.$.gatewayResponse': gatewayResult.raw,
        'refunds.$.completedAt': new Date(),
      },
    },
    { new: true },
  );
  if (!completedTx) {
    throw new AppError(
      503,
      'REFUND_PERSISTENCE_UNCERTAIN',
      'The provider confirmed the refund, but the result could not be committed. Reconcile before retrying.',
    );
  }

  const order = await OrderModel.findById(tx.orderId);
  if (order) {
    order.paymentStatus = nextStatus;
    order.staffNotes.push({
      note: `Refund of ৳${refundAmount.toLocaleString('en-IN')} (${refundId}) processed via ${tx.provider.toUpperCase()}. Reason: ${params.reason}`,
      actorName: params.actor.name,
      timestamp: now,
    });
    await order.save();

    await sendTransactionalEmail({
      to: order.customerEmail,
      template: 'payment_refunded',
      subject: `Refund Processed for Order ${order.orderNumber}`,
      html: `<p>A refund of <strong>৳${refundAmount.toLocaleString()}</strong> for order <strong>${order.orderNumber}</strong> has been processed.</p><p>Refund Reference: <strong>${gatewayRefundId || refundId}</strong></p>`,
    }).catch(() => undefined);
  }

  await writePaymentSystemLog('info', `Refund ${refundId} (৳${refundAmount}) completed for ${tx.transactionId}`, {
    transactionId: tx.transactionId,
    orderNumber: tx.orderNumber,
    provider: tx.provider,
    refundAmount,
    gatewayRefundId,
  });

  await recordAuditLog({
    actor: params.actor,
    action: 'payment.refund',
    resourceType: 'PaymentTransaction',
    resourceId: tx.transactionId,
    summary: `Refunded ৳${refundAmount.toLocaleString('en-IN')} on ${tx.orderNumber} (${tx.provider})`,
    metadata: { refundId, gatewayRefundId, reason: params.reason },
  });

  return {
    transaction: serializePaymentTransaction(completedTx.toObject()),
    refundId,
    gatewayRefundId,
    refundedAmount: refundAmount,
    status: nextStatus,
  };
}
