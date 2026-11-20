import type { PaymentMethod, PaymentProvider, PaymentTransactionStatus } from '../../../../src/lib/orderStateMachine';

export interface GatewayInitiateInput {
  orderNumber: string;
  transactionId: string;
  amount: number;
  currency: 'BDT';
  paymentMethod: PaymentMethod;
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

export interface GatewayInitiateOutput {
  provider: PaymentProvider;
  gatewayUrl: string;
  gatewayPaymentId?: string;
  gatewaySessionKey?: string;
  gatewayOrderId?: string;
  raw?: Record<string, unknown>;
}

export interface GatewayVerifyInput {
  transactionId: string;
  expectedAmount: number;
  expectedCurrency?: string;
  gatewayPaymentId?: string;
  gatewayValidationId?: string;
  paymentRefId?: string;
  payload?: Record<string, unknown>;
}

export interface GatewayVerifyOutput {
  verified: boolean;
  status: PaymentTransactionStatus;
  verifiedAmount?: number;
  currency?: string;
  tranId?: string;
  gatewayPaymentId?: string;
  gatewayTransactionId?: string;
  gatewayValidationId?: string;
  bankTransactionId?: string;
  failureReason?: string;
  raw?: Record<string, unknown>;
}

export interface GatewayRefundInput {
  transactionId: string;
  gatewayPaymentId?: string;
  gatewayTransactionId?: string;
  bankTransactionId?: string;
  amount: number;
  reason: string;
  sku?: string;
}

export interface GatewayRefundOutput {
  success: boolean;
  gatewayRefundId?: string;
  status: 'completed' | 'pending' | 'failed';
  failureReason?: string;
  raw?: Record<string, unknown>;
}

export function amountsMatch(expected: number, actual: number): boolean {
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  if (expected <= 0 || actual <= 0) return false;
  const expectedMinorUnits = Math.round(expected * 100);
  const actualMinorUnits = Math.round(actual * 100);
  return (
    Number.isSafeInteger(expectedMinorUnits) &&
    Number.isSafeInteger(actualMinorUnits) &&
    Math.abs(expected * 100 - expectedMinorUnits) <= 1e-8 &&
    Math.abs(actual * 100 - actualMinorUnits) <= 1e-8 &&
    expectedMinorUnits === actualMinorUnits
  );
}

const SENSITIVE_KEYS = new Set([
  'store_passwd',
  'app_secret',
  'password',
  'private_key',
  'privatekey',
  'id_token',
  'refresh_token',
  'access_token',
  'pan',
  'card_no',
  'cardno',
  'card_number',
  'cardnumber',
  'card_pan',
  'cvv',
  'cvv2',
  'cvc',
  'cvn',
  'security_code',
  'pin',
  'otp',
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api_key',
  'apikey',
  'credentials',
  'client_secret',
  'app_key',
  'merchant_password',
]);

function redactGatewayValue(value: unknown, depth: number): unknown {
  if (depth > 16) return '[TRUNCATED]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactGatewayValue(item, depth + 1));

  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      SENSITIVE_KEYS.has(lower) ||
      lower.includes('secret') ||
      lower.includes('passwd') ||
      lower.includes('password') ||
      lower.includes('token')
    ) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = redactGatewayValue(val, depth + 1);
    }
  }
  return clean;
}

export function redactGatewayPayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  return redactGatewayValue(payload, 0) as Record<string, unknown>;
}
