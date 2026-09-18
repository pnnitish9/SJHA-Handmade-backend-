import express from "express";
import {
  getPaymentConfig,
  getPendingPayments,
  adminVerifyPayment,
  adminRejectPayment,
} from "../controllers/paymentController.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/role.js";

const router = express.Router();

// Public — frontend needs UPI ID / merchant name to render QR code
router.get("/config", getPaymentConfig);

// Admin only
router.get("/pending", protect, authorize("admin"), getPendingPayments);
router.patch("/:paymentId/verify", protect, authorize("admin"), adminVerifyPayment);
router.patch("/:paymentId/reject", protect, authorize("admin"), adminRejectPayment);

export default router;
