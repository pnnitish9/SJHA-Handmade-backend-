import slugify from "slugify";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import APIFeatures from "../utils/apiFeatures.js";
import { uploadManyToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";

// @desc    List products — supports ?search, ?category, ?price[gte]/[lte],
//          ?isFeatured, ?sort, ?page, ?limit
// @route   GET /api/products
// @access  Public
export const getProducts = asyncHandler(async (req, res) => {
  const baseFilter = req.user?.role === "admin" ? {} : { isAvailable: true };

  const featuresQuery = new APIFeatures(
    Product.find(baseFilter).populate("category", "name slug"),
    req.query
  )
    .search()
    .filter()
    .sort()
    .paginate();

  const [products, total] = await Promise.all([
    featuresQuery.query,
    Product.countDocuments({
      ...baseFilter,
      ...(req.query.category ? { category: req.query.category } : {}),
    }),
  ]);

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    page: featuresQuery.pagination.page,
    pages: Math.ceil(total / featuresQuery.pagination.limit),
    products,
  });
});

// @desc    Get a single product by slug (with populated category)
// @route   GET /api/products/:slug
// @access  Public
export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug }).populate("category", "name slug");
  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found." });
  }
  res.status(200).json({ success: true, product });
});

// @desc    Get a single product by its Mongo _id — used by the admin edit form,
//          which only has the id (not the slug) from the products list
// @route   GET /api/products/id/:id
// @access  Private/Admin
export const getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).populate("category", "name slug");
  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found." });
  }
  res.status(200).json({ success: true, product });
});

// @desc    Create a product (multipart/form-data — fields + up to 8 images)
// @route   POST /api/products
// @access  Private/Admin
export const createProduct = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    shortDescription,
    category,
    tags,
    price,
    discountPrice,
    stock,
    lowStockThreshold,
    isFeatured,
    isAvailable,
    variants,
  } = req.body;

  const slug = slugify(name, { lower: true, strict: true });
  const existing = await Product.findOne({ slug });
  if (existing) {
    return res.status(409).json({ success: false, message: "A product with this name already exists." });
  }

  let images = [];
  if (req.files?.length) {
    const uploaded = await uploadManyToCloudinary(req.files, "sjha-handmade/products");
    images = uploaded.map((img, i) => ({ ...img, isPrimary: i === 0 }));
  }

  const product = await Product.create({
    name,
    slug,
    description,
    shortDescription,
    category,
    tags: parseListField(tags),
    price,
    discountPrice: discountPrice || undefined,
    images,
    variants: parseJsonField(variants, []),
    stock: stock ?? 0,
    lowStockThreshold: lowStockThreshold ?? 5,
    isFeatured: isFeatured === "true" || isFeatured === true,
    isAvailable: isAvailable === undefined ? true : isAvailable === "true" || isAvailable === true,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, product });
});

// @desc    Update a product — supports adding new images and removing
//          existing ones by publicId via `removeImageIds`
// @route   PATCH /api/products/:id
// @access  Private/Admin
export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found." });
  }

  const textFields = [
    "name",
    "description",
    "shortDescription",
    "category",
    "price",
    "discountPrice",
    "stock",
    "lowStockThreshold",
  ];
  textFields.forEach((field) => {
    if (req.body[field] !== undefined && req.body[field] !== "") {
      product[field] = req.body[field];
    }
  });

  if (req.body.name) {
    product.slug = slugify(req.body.name, { lower: true, strict: true });
  }
  if (req.body.tags !== undefined) product.tags = parseListField(req.body.tags);
  if (req.body.variants !== undefined) product.variants = parseJsonField(req.body.variants, product.variants);
  if (req.body.isFeatured !== undefined) product.isFeatured = req.body.isFeatured === "true" || req.body.isFeatured === true;
  if (req.body.isAvailable !== undefined) product.isAvailable = req.body.isAvailable === "true" || req.body.isAvailable === true;

  // Remove images the admin explicitly deleted
  const removeIds = parseListField(req.body.removeImageIds);
  if (removeIds.length) {
    const toRemove = product.images.filter((img) => removeIds.includes(img.publicId));
    await Promise.all(toRemove.map((img) => deleteFromCloudinary(img.publicId)));
    product.images = product.images.filter((img) => !removeIds.includes(img.publicId));
  }

  // Add newly uploaded images
  if (req.files?.length) {
    const uploaded = await uploadManyToCloudinary(req.files, "sjha-handmade/products");
    const hadPrimary = product.images.some((img) => img.isPrimary);
    uploaded.forEach((img, i) => {
      product.images.push({ ...img, isPrimary: !hadPrimary && i === 0 });
    });
  }

  await product.save();
  res.status(200).json({ success: true, product });
});

// @desc    Delete a product (and its Cloudinary images)
// @route   DELETE /api/products/:id
// @access  Private/Admin
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found." });
  }

  await Promise.all(product.images.map((img) => deleteFromCloudinary(img.publicId)));
  await product.deleteOne();

  res.status(200).json({ success: true, message: "Product deleted." });
});

// --- helpers -----------------------------------------------------------

// Accepts either a real array (JSON body) or a comma-separated string
// (multipart/form-data, where arrays don't travel natively)
function parseListField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // not JSON — fall through to comma-split
  }
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseJsonField(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
