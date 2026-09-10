import jwt from "jsonwebtoken";

// Sign a JWT containing the user's id and role
export const signToken = (userId, role) => {
  return jwt.sign({ id: userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

// Attach the token as an HTTP-only cookie and send the JSON response
export const sendTokenResponse = (user, statusCode, res) => {
  const token = signToken(user._id, user.role);

  const cookieExpiresDays = Number(process.env.JWT_COOKIE_EXPIRES_DAYS) || 7;

  // Cross-origin deployments (frontend on Vercel, backend on Vercel/Render)
  // require Secure + SameSite=None for the browser to send the cookie at all.
  // We always use these flags — local dev with http://localhost still works
  // because modern browsers allow SameSite=None on localhost.
  const cookieOptions = {
    expires: new Date(Date.now() + cookieExpiresDays * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  };

  res
    .status(statusCode)
    .cookie("token", token, cookieOptions)
    .json({
      success: true,
      user: user.toSafeObject ? user.toSafeObject() : user,
    });
};
