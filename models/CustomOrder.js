import mongoose from "mongoose";

const customOrderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    productType: { type: String, required: true }, // e.g. "Crochet Bag"
    preferredColor: { type: String },
    preferredSize: { type: String },
    budget: { type: Number },
    description: { type: String, required: true },
    referenceImages: [{ url: String, publicId: String }],
    status: {
      type: String,
      enum: ["submitted", "in_discussion", "approved", "rejected", "converted"],
      default: "submitted",
    },
    adminNotes: { type: String },
    convertedOrder: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  },
  { timestamps: true }
);

export default mongoose.model("CustomOrder", customOrderSchema);
