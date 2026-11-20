import { ReviewModel } from './review.model';
import { ProductModel } from '../products/product.model';
import { AppError } from '../../middleware/error.middleware';
import mongoose from 'mongoose';
import { invalidatePublicCatalogCaches } from '../../utils/ttlCache';

export async function recomputeProductRating(productId: unknown) {
  const agg = await ReviewModel.aggregate([
    { $match: { productId, status: 'approved', deletedAt: null } },
    { $group: { _id: '$productId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const avg = agg[0]?.avg ? Number(agg[0].avg.toFixed(2)) : 0;
  const count = agg[0]?.count ? Number(agg[0].count) : 0;
  await ProductModel.updateOne({ _id: productId }, { $set: { ratingAverage: avg, reviewCount: count } });
}

export async function listReviewsAdmin(params: {
  status?: string;
  rating?: number;
  q?: string;
  productId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}) {
  const filter: Record<string, unknown> = { deletedAt: null };
  if (params.status) filter.status = params.status;
  if (params.rating) filter.rating = params.rating;
  if (params.productId && mongoose.isValidObjectId(params.productId)) {
    filter.productId = new mongoose.Types.ObjectId(params.productId);
  }
  if (params.from || params.to) {
    const createdAt: Record<string, Date> = {};
    if (params.from) createdAt.$gte = new Date(params.from);
    if (params.to) {
      const end = new Date(params.to);
      end.setHours(23, 59, 59, 999);
      createdAt.$lte = end;
    }
    filter.createdAt = createdAt;
  }
  if (params.q) {
    const regex = new RegExp(params.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ userName: regex }, { title: regex }, { comment: regex }];
  }
  const [reviews, total] = await Promise.all([
    ReviewModel.find(filter)
    .populate('productId', 'name slug sku images')
    .sort({ createdAt: -1 })
    .skip((params.page - 1) * params.limit)
    .limit(params.limit)
    .lean(),
    ReviewModel.countDocuments(filter),
  ]);
  const [pending, approved, rejected] = await Promise.all([
    ReviewModel.countDocuments({ deletedAt: null, status: 'pending' }),
    ReviewModel.countDocuments({ deletedAt: null, status: 'approved' }),
    ReviewModel.countDocuments({ deletedAt: null, status: 'rejected' }),
  ]);
  return {
    reviews: reviews.map((r) => ({ ...r, id: String(r._id) })),
    pagination: { page: params.page, limit: params.limit, total, totalPages: Math.max(1, Math.ceil(total / params.limit)) },
    counts: { total: pending + approved + rejected, pending, approved, rejected },
  };
}

export async function getReviewByIdAdmin(id: string) {
  const review = await ReviewModel.findById(id).populate('productId', 'name slug sku images').lean();
  if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  return { ...review, id: String(review._id) };
}

export async function moderateReviewAdmin(params: {
  id: string;
  status: 'approved' | 'rejected';
  reason?: string;
  actorId: unknown;
}) {
  const review = await ReviewModel.findById(params.id);
  if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  if (review.deletedAt) throw new AppError(409, 'REVIEW_DELETED', 'A deleted review cannot be moderated.');
  if (review.status !== 'pending') {
    throw new AppError(409, 'INVALID_REVIEW_TRANSITION', 'Only pending reviews can be approved or rejected.');
  }

  const previousStatus = review.status;
  review.status = params.status;
  review.moderationReason = params.reason;
  review.moderatedBy = params.actorId as typeof review.moderatedBy;
  review.moderatedAt = new Date();
  review.moderationHistory.push({
    action: params.status,
    actorId: params.actorId as mongoose.Types.ObjectId,
    previousStatus,
    newStatus: params.status,
    reason: params.reason,
    timestamp: new Date(),
  });
  await review.save();

  await recomputeProductRating(review.productId);
  invalidatePublicCatalogCaches();
  return { ...review.toObject(), id: String(review._id) };
}

export async function setReviewFeaturedAdmin(id: string, isFeatured: boolean) {
  const review = await ReviewModel.findById(id);
  if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  review.isFeatured = isFeatured;
  await review.save();
  invalidatePublicCatalogCaches();
  return { ...review.toObject(), id: String(review._id) };
}

export async function deleteReviewAdmin(id: string, actorId?: unknown) {
  const review = await ReviewModel.findById(id);
  if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  if (review.deletedAt) throw new AppError(409, 'REVIEW_ALREADY_DELETED', 'Review has already been deleted.');
  const productId = review.productId;
  const previousStatus = review.status;
  review.deletedAt = new Date();
  review.moderationHistory.push({
    action: 'deleted',
    actorId: actorId as mongoose.Types.ObjectId,
    previousStatus,
    newStatus: previousStatus,
    timestamp: new Date(),
  });
  await review.save();
  await recomputeProductRating(productId);
  invalidatePublicCatalogCaches();
  return { id };
}
