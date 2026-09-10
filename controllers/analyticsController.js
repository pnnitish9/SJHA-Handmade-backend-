import Order from "../models/Order.js";
import User from "../models/User.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorHandler.js";

// @desc    Dashboard analytics — revenue, order/customer counts, low-stock
//          alerts, recent orders, top products, and a daily sales trend
// @route   GET /api/admin/analytics
// @access  Private/Admin
export const getDashboardAnalytics = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const paidStatusFilter = { paymentStatus: "paid" };

  const [
    totalRevenueAgg,
    monthRevenueAgg,
    orderCounts,
    customerCount,
    lowStockProducts,
    outOfStockCount,
    recentOrders,
    topProductsAgg,
    salesTrendAgg,
  ] = await Promise.all([
    Order.aggregate([{ $match: paidStatusFilter }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    Order.aggregate([
      { $match: { ...paidStatusFilter, createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    User.countDocuments({ role: "customer" }),
    Product.find({
      isAvailable: true,
      $expr: { $lte: ["$stock", "$lowStockThreshold"] },
      variants: { $size: 0 }, // simple stock model only; variant-level alerts would need $elemMatch per variant
    })
      .select("name stock lowStockThreshold images")
      .limit(10),
    Product.countDocuments({ isAvailable: true, stock: 0, variants: { $size: 0 } }),
    Order.find().populate("user", "name email").sort("-createdAt").limit(8),
    Order.aggregate([
      { $match: paidStatusFilter },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          name: { $first: "$items.name" },
          image: { $first: "$items.image" },
          unitsSold: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { unitsSold: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([
      { $match: { ...paidStatusFilter, createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$total" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const statusCounts = orderCounts.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});

  res.status(200).json({
    success: true,
    analytics: {
      revenue: {
        total: totalRevenueAgg[0]?.total || 0,
        thisMonth: monthRevenueAgg[0]?.total || 0,
      },
      orders: {
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        byStatus: statusCounts,
      },
      customers: { total: customerCount },
      inventory: {
        lowStock: lowStockProducts,
        outOfStockCount,
      },
      recentOrders,
      topProducts: topProductsAgg,
      salesTrend: salesTrendAgg,
    },
  });
});
