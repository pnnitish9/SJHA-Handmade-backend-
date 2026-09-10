import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true }, // proves delivery
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String },
    comment: { type: String, required: true },
    images: [{ url: String, publicId: String }],
    isVerifiedPurchase: { type: Boolean, default: true },
    isHidden: { type: Boolean, default: false }, // admin moderation
  },
  { timestamps: true }
);

reviewSchema.index({ product: 1, user: 1, order: 1 }, { unique: true });

export default mongoose.model("Review", reviewSchema);
