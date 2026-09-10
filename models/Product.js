import mongoose from "mongoose";

const variantSchema = new mongoose.Schema(
  {
    color: { type: String },
    size: { type: String },
    sku: { type: String },
    price: { type: Number },
    stock: { type: Number, default: 0, min: 0 },
    images: [{ url: String, publicId: String }],
  },
  { _id: true }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, required: true },
    shortDescription: { type: String },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    tags: [{ type: String }],

    price: { type: Number, required: true, min: 0 },
    discountPrice: { type: Number, min: 0 },

    images: [{ url: String, publicId: String, isPrimary: { type: Boolean, default: false } }],
    variants: [variantSchema],

    stock: { type: Number, default: 0, min: 0 }, // used when no variants
    lowStockThreshold: { type: Number, default: 5 },

    isFeatured: { type: Boolean, default: false },
    isAvailable: { type: Boolean, default: true },

    ratingsAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingsCount: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

productSchema.index({ slug: 1 });
productSchema.index({ name: "text", description: "text", tags: "text" });
productSchema.index({ category: 1 });
productSchema.index({ category: 1, isAvailable: 1 }); // matches shop listing: filter by category + availability

export default mongoose.model("Product", productSchema);
