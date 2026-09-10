import slugify from "slugify";
import Category from "../models/Category.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { uploadBufferToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";

// @desc    List categories (public sees only active ones; admin sees all)
// @route   GET /api/categories
// @access  Public
export const getCategories = asyncHandler(async (req, res) => {
  const filter = req.user?.role === "admin" ? {} : { isActive: true };
  const categories = await Category.find(filter).sort("displayOrder name");
  res.status(200).json({ success: true, count: categories.length, categories });
});

// @desc    Get a single category by slug
// @route   GET /api/categories/:slug
// @access  Public
export const getCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug });
  if (!category) {
    return res.status(404).json({ success: false, message: "Category not found." });
  }
  res.status(200).json({ success: true, category });
});

// @desc    Create a category
// @route   POST /api/categories
// @access  Private/Admin
export const createCategory = asyncHandler(async (req, res) => {
  const { name, description, parentCategory, displayOrder } = req.body;

  const existing = await Category.findOne({ name });
  if (existing) {
    return res.status(409).json({ success: false, message: "A category with this name already exists." });
  }

  let image = { url: "", publicId: "" };
  if (req.file) {
    const result = await uploadBufferToCloudinary(req.file.buffer, "sjha-handmade/categories");
    image = { url: result.secure_url, publicId: result.public_id };
  }

  const category = await Category.create({
    name,
    slug: slugify(name, { lower: true, strict: true }),
    description,
    parentCategory: parentCategory || null,
    displayOrder: displayOrder || 0,
    image,
  });

  res.status(201).json({ success: true, category });
});

// @desc    Update a category
// @route   PATCH /api/categories/:id
// @access  Private/Admin
export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    return res.status(404).json({ success: false, message: "Category not found." });
  }

  const { name, description, parentCategory, displayOrder, isActive } = req.body;

  if (name && name !== category.name) {
    category.name = name;
    category.slug = slugify(name, { lower: true, strict: true });
  }
  if (description !== undefined) category.description = description;
  if (parentCategory !== undefined) category.parentCategory = parentCategory || null;
  if (displayOrder !== undefined) category.displayOrder = displayOrder;
  if (isActive !== undefined) category.isActive = isActive;

  if (req.file) {
    if (category.image?.publicId) await deleteFromCloudinary(category.image.publicId);
    const result = await uploadBufferToCloudinary(req.file.buffer, "sjha-handmade/categories");
    category.image = { url: result.secure_url, publicId: result.public_id };
  }

  await category.save();
  res.status(200).json({ success: true, category });
});

// @desc    Delete a category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    return res.status(404).json({ success: false, message: "Category not found." });
  }

  if (category.image?.publicId) await deleteFromCloudinary(category.image.publicId);
  await category.deleteOne();

  res.status(200).json({ success: true, message: "Category deleted." });
});
