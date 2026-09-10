import express from "express";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/role.js";
import { getAllReviews, setReviewVisibility } from "../controllers/reviewController.js";
import { getDashboardAnalytics } from "../controllers/analyticsController.js";
import { getCustomers, getCustomer, setCustomerStatus } from "../controllers/customerController.js";

const router = express.Router();

// Every route below requires a valid JWT AND role === "admin"
router.use(protect, authorize("admin"));

router.get("/analytics", getDashboardAnalytics);

router.get("/reviews", getAllReviews);
router.patch("/reviews/:id/visibility", setReviewVisibility);

router.get("/customers", getCustomers);
router.get("/customers/:id", getCustomer);
router.patch("/customers/:id/status", setCustomerStatus);

export default router;
