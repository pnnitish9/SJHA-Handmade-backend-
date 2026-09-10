import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server } from "socket.io";

import connectDB from "./config/db.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import { socketAuthMiddleware } from "./middleware/socketAuth.js";
import { postMessage } from "./controllers/conversationController.js";
import { handleWebhook } from "./controllers/paymentController.js";

import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import productReviewRoutes from "./routes/productReviewRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import conversationRoutes from "./routes/conversationRoutes.js";
import customOrderRoutes from "./routes/customOrderRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";


// APP INITIALIZATION

const app = express();


// ======================================================
// RAZORPAY WEBHOOK
// IMPORTANT: Must be BEFORE express.json()
// ======================================================

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);


// ======================================================
// SECURITY & CORE MIDDLEWARE
// ======================================================

app.use(helmet());

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://handmadesjha.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


// ======================================================
// LOGGER
// ======================================================

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}


// ======================================================
// RATE LIMITING
// ======================================================

// Authentication rate limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    message: "Too many attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", generalLimiter);


// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "SJHA Handmade API is running.",
  });
});


// ======================================================
// API ROUTES
// ======================================================

app.use("/api/auth", authLimiter, authRoutes);

app.use("/api/admin", adminRoutes);

app.use("/api/categories", categoryRoutes);

app.use("/api/products", productRoutes);

app.use("/api/products", productReviewRoutes);

app.use("/api/cart", cartRoutes);

app.use("/api/wishlist", wishlistRoutes);

app.use("/api/orders", orderRoutes);

app.use("/api/payments", paymentRoutes);

app.use("/api/coupons", couponRoutes);

app.use("/api/reviews", reviewRoutes);

app.use("/api/conversations", conversationRoutes);

app.use("/api/custom-orders", customOrderRoutes);

app.use("/api/notifications", notificationRoutes);


// ======================================================
// ERROR HANDLING
// Must be LAST after all routes
// ======================================================

app.use(notFound);

app.use(errorHandler);


// ======================================================
// HTTP SERVER
// ======================================================

const httpServer = createServer(app);


// ======================================================
// SOCKET.IO
// ======================================================

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  },
});


// Socket authentication
io.use(socketAuthMiddleware);


// ======================================================
// SOCKET.IO CONNECTION
// ======================================================

io.on("connection", (socket) => {
  console.log(
    `Socket connected: ${socket.id} (user ${socket.user.id}, role ${socket.user.role})`
  );


  // ----------------------------------------------------
  // Admin shared room
  // ----------------------------------------------------

  if (socket.user.role === "admin") {
    socket.join("admins");
  }


  // ----------------------------------------------------
  // Join conversation
  // ----------------------------------------------------

  socket.on("join_conversation", (conversationId) => {
    socket.join(`conversation:${conversationId}`);
  });


  // ----------------------------------------------------
  // Leave conversation
  // ----------------------------------------------------

  socket.on("leave_conversation", (conversationId) => {
    socket.leave(`conversation:${conversationId}`);
  });


  // ----------------------------------------------------
  // Send message
  // ----------------------------------------------------

  socket.on(
    "send_message",
    async ({ conversationId, text }, callback) => {
      try {
        if (!text?.trim()) {
          return;
        }

        const { message, conversation } = await postMessage({
          conversationId,
          senderId: socket.user.id,
          senderRole: socket.user.role,
          text: text.trim(),
        });


        // Send message to current conversation
        io.to(`conversation:${conversationId}`).emit(
          "new_message",
          message
        );


        // Update admin inbox
        io.to("admins").emit(
          "conversation_updated",
          conversation
        );


        callback?.({
          success: true,
        });

      } catch (error) {
        callback?.({
          success: false,
          message:
            error.message ||
            "Could not send message.",
        });
      }
    }
  );


  // ----------------------------------------------------
  // Typing indicator
  // ----------------------------------------------------

  socket.on(
    "typing",
    ({ conversationId, isTyping }) => {
      socket
        .to(`conversation:${conversationId}`)
        .emit("typing", {
          userId: socket.user.id,
          role: socket.user.role,
          isTyping,
        });
    }
  );


  // ----------------------------------------------------
  // Disconnect
  // ----------------------------------------------------

  socket.on("disconnect", () => {
    console.log(
      `Socket disconnected: ${socket.id}`
    );
  });
});


// ======================================================
// SERVER STARTUP
// IMPORTANT: Connect MongoDB BEFORE accepting requests
// ======================================================

const PORT = process.env.PORT || 5000;


const startServer = async () => {
  try {

    console.log("Connecting to MongoDB...");

    await connectDB();

    console.log("MongoDB connection successful.");

    httpServer.listen(PORT, () => {
      console.log(
        `Server running in ${
          process.env.NODE_ENV || "development"
        } mode on port ${PORT}`
      );
    });

  } catch (error) {

    console.error(
      "Failed to start server:",
      error
    );

    process.exit(1);
  }
};


startServer();


// ======================================================
// UNHANDLED PROMISE REJECTIONS
// ======================================================

process.on("unhandledRejection", (err) => {

  console.error(
    `Unhandled Rejection: ${err.message}`
  );

  httpServer.close(() => {
    process.exit(1);
  });

});


// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

process.on("SIGTERM", () => {

  console.log(
    "SIGTERM received — shutting down gracefully."
  );

  httpServer.close(() => {

    console.log(
      "HTTP server closed."
    );

    process.exit(0);

  });

});