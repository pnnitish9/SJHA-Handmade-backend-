import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // assigned admin, optional
    subject: { type: String, default: "General Inquiry" },
    relatedCustomOrder: { type: mongoose.Schema.Types.ObjectId, ref: "CustomOrder" },
    lastMessage: { type: String },
    lastMessageAt: { type: Date, default: Date.now },
    unreadByCustomer: { type: Number, default: 0 },
    unreadByAdmin: { type: Number, default: 0 },
    isClosed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

conversationSchema.index({ customer: 1 });

export default mongoose.model("Conversation", conversationSchema);
