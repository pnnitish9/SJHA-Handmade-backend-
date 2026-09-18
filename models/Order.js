import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, required: true }, // snapshot at time of order
    image: { type: String },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: true }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: [
        "payment_pending",       // order created, no proof yet
        "payment_verification",  // proof submitted, awaiting admin
        "placed",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "payment_failed",        // admin rejected or payment failed
        "cancelled",
        "returned",
      ],
      required: true,
    },
    note: { type: String },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [orderItemSchema],

    shippingAddress: {
      fullName: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },

    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    shippingFee: { type: Number, default: 0 },
    total: { type: Number, required: true },

    paymentMethod: {
      type: String,
      enum: ["upi_manual", "razorpay", "cod"], // "razorpay"/"cod" kept for historical records
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "verification_pending", "paid", "rejected", "failed", "refunded"],
      default: "pending",
    },
    paymentRef: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },

    status: {
      type: String,
      enum: [
        "payment_pending",
        "payment_verification",
        "placed",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "payment_failed",
        "cancelled",
        "returned",
      ],
      default: "payment_pending",
    },
    statusHistory: [statusHistorySchema],

    trackingNumber: { type: String },
    isReviewed: { type: Boolean, default: false },
    source: { type: String, enum: ["shop", "custom"], default: "shop" },
    customOrderRef: { type: mongoose.Schema.Types.ObjectId, ref: "CustomOrder", default: null },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("Order", orderSchema);
