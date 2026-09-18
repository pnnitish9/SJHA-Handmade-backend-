import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    method: {
      type: String,
      enum: ["upi_manual", "razorpay"], // "razorpay" kept so historical records remain readable
      default: "upi_manual",
    },

    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },

    status: {
      type: String,
      enum: ["verification_pending", "verified", "rejected", "failed", "refunded"],
      default: "verification_pending",
    },

    // ── UPI manual payment fields ──────────────────────────────────────────
    payerName: { type: String, trim: true },
    payerPhone: { type: String, trim: true },
    bankName: { type: String, trim: true },    // UPI app / bank name
    transactionId: { type: String, trim: true }, // UTR / transaction reference
    paymentDate: { type: Date },
    paymentTime: { type: String, trim: true },  // "HH:MM" as entered by customer

    screenshot: {
      url: { type: String },
      publicId: { type: String },
    },

    // ── Admin verification fields ──────────────────────────────────────────
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    verifiedAt: { type: Date },
    rejectionReason: { type: String, trim: true },

    // ── Legacy Razorpay fields (kept read-only for historical orders) ──────
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
  },
  { timestamps: true }
);

// Index on transactionId for duplicate-UTR detection.
// The sparse option ensures null/undefined values are not indexed, so
// orders that genuinely have no UTR yet don't collide.
paymentSchema.index({ transactionId: 1 }, { sparse: true });

export default mongoose.model("Payment", paymentSchema);
