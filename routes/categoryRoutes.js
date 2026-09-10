import express from "express";
import {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";
import { protect, attachUserIfPresent } from "../middleware/auth.js";
import { authorize } from "../middleware/role.js";
import upload from "../middleware/upload.js";

const router = express.Router();

router.get("/", attachUserIfPresent, getCategories);
router.get("/:slug", getCategory);

router.post("/", protect, authorize("admin"), upload.single("image"), createCategory);
router.patch("/:id", protect, authorize("admin"), upload.single("image"), updateCategory);
router.delete("/:id", protect, authorize("admin"), deleteCategory);

export default router;
