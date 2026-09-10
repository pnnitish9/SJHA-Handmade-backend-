import express from "express";
import {
  getProducts,
  getProduct,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController.js";
import { protect, attachUserIfPresent } from "../middleware/auth.js";
import { authorize } from "../middleware/role.js";
import upload from "../middleware/upload.js";

const router = express.Router();

router.get("/", attachUserIfPresent, getProducts);
router.get("/id/:id", protect, authorize("admin"), getProductById); // must precede /:slug
router.get("/:slug", getProduct);

router.post("/", protect, authorize("admin"), upload.array("images", 8), createProduct);
router.patch("/:id", protect, authorize("admin"), upload.array("images", 8), updateProduct);
router.delete("/:id", protect, authorize("admin"), deleteProduct);

export default router;
