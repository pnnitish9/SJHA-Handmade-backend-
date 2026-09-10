import jwt from "jsonwebtoken";
import cookie from "cookie";
import User from "../models/User.js";

// Runs once per socket connection attempt. Rejects the connection outright
// if there's no valid session. Accepts the token from either:
//   1. The httpOnly cookie (desktop browsers)
//   2. socket.handshake.auth.token (mobile fallback — sent by SocketContext)
export async function socketAuthMiddleware(socket, next) {
  try {
    let token;

    // 1. Try the httpOnly cookie first (desktop)
    const rawCookie = socket.handshake.headers.cookie;
    if (rawCookie) {
      token = cookie.parse(rawCookie).token || null;
    }

    // 2. Fall back to the auth object sent by the client (mobile / Safari ITP)
    if (!token && socket.handshake.auth?.token) {
      token = socket.handshake.auth.token;
    }

    if (!token) return next(new Error("Not authenticated."));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) return next(new Error("Not authenticated."));

    socket.user = { id: user._id.toString(), name: user.name, role: user.role };
    next();
  } catch {
    next(new Error("Not authenticated."));
  }
}
