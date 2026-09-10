import express from "express";
import {
  createCustomOrder,
  getMyCustomOrders,
  getAllCustomOrders,
  respondToCustomOrder,
} from "../controllers/customOrderController.js";
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/role.js";
import upload from "../middleware/upload.js";

const router = express.Router();

router.use(protect);

router.post("/", upload.array("referenceImages", 4), createCustomOrder);
router.get("/mine", getMyCustomOrders);

router.get("/", authorize("admin"), getAllCustomOrders);
router.patch("/:id", authorize("admin"), respondToCustomOrder);

export default router;
