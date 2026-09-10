import mongoose from "mongoose";
import Review from "../models/Review.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { uploadManyToCloudinary } from "../utils/cloudinaryUpload.js";

// Recalculates and persists a product's ratingsAverage / ratingsCount
async function recalculateProductRating(productId) {
  // Aggregation pipelines do NOT auto-coerce strings to ObjectIds the way
  // Mongoose find() does. Always cast here so $match works regardless of
  // whether productId arrived as a FormData string or a Mongoose ObjectId.
  const oid =
    productId instanceof mongoose.Types.ObjectId
      ? productId
      : new mongoose.Types.ObjectId(String(productId));

  const stats = await Review.aggregate([
    { $match: { product: oid, isHidden: false } },
    { $group: { _id: "$product", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);

  const { avg = 0, count = 0 } = stats[0] || {};
  await Product.findByIdAndUpdate(productId, {
    ratingsAverage: Math.round(avg * 10) / 10,
    ratingsCount: count,
  });
}

// @desc    List visible reviews for a product
// @route   GET /api/products/:productId/reviews
// @access  Public
export const getProductReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ product: req.params.productId, isHidden: false })
    .populate("user", "name")
    .sort("-createdAt");
  res.status(200).json({ success: true, count: reviews.length, reviews });
});

// @desc    Return product IDs the current user has already reviewed for a given order
// @route   GET /api/reviews/my-reviewed-products?orderId=<id>
// @access  Private
export const getMyReviewedProducts = asyncHandler(async (req, res) => {
  const { orderId } = req.query;
  const filter = { user: req.user._id };
  if (orderId) filter.order = orderId;

  const reviews = await Review.find(filter).select("product -_id");
  const reviewedProductIds = reviews.map((r) => r.product.toString());

  res.status(200).json({ success: true, reviewedProductIds });
});

// @desc    Submit a review — only for a product in an order the user placed
//          that has been delivered
// @route   POST /api/reviews
// @access  Private
export const createReview = asyncHandler(async (req, res) => {
  const { orderId, productId, rating, title, comment } = req.body;

  const order = await Order.findById(orderId);
  if (!order || order.user.toString() !== req.user._id.toString()) {
    return res.status(404).json({ success: false, message: "Order not found." });
  }
  if (order.status !== "delivered") {
    return res.status(400).json({ success: false, message: "You can only review products after delivery." });
  }
  const orderedProduct = order.items.some((item) => item.product.toString() === productId);
  if (!orderedProduct) {
    return res.status(400).json({ success: false, message: "This product wasn't part of that order." });
  }

  const existing = await Review.findOne({ product: productId, user: req.user._id, order: orderId });
  if (existing) {
    return res.status(409).json({ success: false, message: "You've already reviewed this product for this order." });
  }

  let images = [];
  if (req.files?.length) {
    images = await uploadManyToCloudinary(req.files, "sjha-handmade/reviews");
  }

  const review = await Review.create({
    product: productId,
    user: req.user._id,
    order: orderId,
    rating,
    title,
    comment,
    images,
  });

  await recalculateProductRating(productId);

  // Mark the order as reviewed so the customer can't see the "Write a review"
  // prompt again after a page reload (the frontend also uses this flag).
  await Order.findByIdAndUpdate(orderId, { isReviewed: true });

  res.status(201).json({ success: true, review });
});

// @desc    Update your own review
// @route   PATCH /api/reviews/:id
// @access  Private
export const updateReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) return res.status(404).json({ success: false, message: "Review not found." });
  if (review.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "Not authorized." });
  }

  const { rating, title, comment } = req.body;
  if (rating !== undefined) review.rating = rating;
  if (title !== undefined) review.title = title;
  if (comment !== undefined) review.comment = comment;

  await review.save();
  await recalculateProductRating(review.product);

  res.status(200).json({ success: true, review });
});

// @desc    Delete your own review (or any review, if admin)
// @route   DELETE /api/reviews/:id
// @access  Private
export const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) return res.status(404).json({ success: false, message: "Review not found." });
  if (review.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Not authorized." });
  }

  const productId = review.product;
  await review.deleteOne();
  await recalculateProductRating(productId);

  res.status(200).json({ success: true, message: "Review deleted." });
});

// @desc    List all reviews (moderation queue)
// @route   GET /api/admin/reviews
// @access  Private/Admin
export const getAllReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find()
    .populate("user", "name email")
    .populate("product", "name slug")
    .sort("-createdAt");
  res.status(200).json({ success: true, count: reviews.length, reviews });
});

// @desc    Hide or unhide a review
// @route   PATCH /api/admin/reviews/:id/visibility
// @access  Private/Admin
export const setReviewVisibility = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) return res.status(404).json({ success: false, message: "Review not found." });

  review.isHidden = req.body.isHidden;
  await review.save();
  await recalculateProductRating(review.product);

  res.status(200).json({ success: true, review });
});
