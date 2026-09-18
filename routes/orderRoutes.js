import express from "express";
import {
  createOrder,
  getMyOrders,
  getOrder,
  cancelOrder,
  getAllOrders,
  updateOrderStatus,
} from "../controllers/orderController.js";
import { submitPaymentProof } from "../controllers/paymentController.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/role.js";
import upload from "../middleware/upload.js";

const router = express.Router();

router.use(protect);

// Customer
router.post("/", createOrder);
router.get("/mine", getMyOrders);
router.patch("/:id/cancel", cancelOrder);

// Submit payment proof — single screenshot file upload
router.post(
  "/:orderId/payment-proof",
  upload.single("screenshot"),
  submitPaymentProof
);

// Admin — declared before the generic "/:id" so they aren't swallowed by it
router.get("/", authorize("admin"), getAllOrders);
router.patch("/:id/status", authorize("admin"), updateOrderStatus);

// Shared (owner or admin — access control checked inside controller)
router.get("/:id", getOrder);

export default router;
