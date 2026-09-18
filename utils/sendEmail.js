import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: Number(process.env.EMAIL_PORT) === 465,
      auth: process.env.EMAIL_USER
        ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        : undefined,
    });
  }
  return transporter;
}

// Fire-and-forget — email failures should never break a checkout or status update.
export const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.EMAIL_HOST) {
    console.log(`[email skipped — no EMAIL_HOST configured] To: ${to} | Subject: ${subject}`);
    return;
  }
  try {
    await getTransporter().sendMail({
      from: `"SJHA Handmade" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
  } catch (error) {
    console.error(`Failed to send email to ${to}: ${error.message}`);
  }
};

export const orderConfirmationEmail = (order, userName) => ({
  subject: `Order confirmed — ${order.orderNumber}`,
  html: `
    <p>Hi ${userName},</p>
    <p>Thanks for your order! We've received <strong>${order.orderNumber}</strong> and we're getting it ready.</p>
    <ul>
      ${order.items.map((item) => `<li>${item.name} × ${item.quantity} — ₹${item.price * item.quantity}</li>`).join("")}
    </ul>
    <p><strong>Total: ₹${order.total}</strong></p>
    <p>Payment method: ${order.paymentMethod === "cod" ? "Cash on delivery" : "Paid online"}</p>
    <p>We'll email you again when your order ships.</p>
    <p>— SJHA Handmade</p>
  `,
});

export const orderStatusEmail = (order, userName) => ({
  subject: `Order ${order.orderNumber} is now ${order.status}`,
  html: `
    <p>Hi ${userName},</p>
    <p>Your order <strong>${order.orderNumber}</strong> is now <strong>${order.status}</strong>.</p>
    ${order.trackingNumber ? `<p>Tracking number: ${order.trackingNumber}</p>` : ""}
    <p>— SJHA Handmade</p>
  `,
});

export const paymentRejectedEmail = (order, userName, reason) => ({
  subject: `Payment rejected — ${order.orderNumber}`,
  html: `
    <p>Hi ${userName},</p>
    <p>Unfortunately, your payment for order <strong>${order.orderNumber}</strong> could not be verified.</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <p>Your reserved items have been released. You are welcome to place a new order and try again.</p>
    <p>If you believe this is an error, please contact us with your UTR / transaction ID.</p>
    <p>— SJHA Handmade</p>
  `,
});

export const paymentVerifiedEmail = (order, userName) => ({
  subject: `Payment verified — ${order.orderNumber}`,
  html: `
    <p>Hi ${userName},</p>
    <p>Great news! Your payment for order <strong>${order.orderNumber}</strong> has been verified.</p>
    <p>Your order is now confirmed and we are preparing it for dispatch.</p>
    <ul>
      ${order.items.map((item) => `<li>${item.name} × ${item.quantity} — ₹${item.price * item.quantity}</li>`).join("")}
    </ul>
    <p><strong>Total: ₹${order.total}</strong></p>
    <p>We'll email you again when your order ships.</p>
    <p>— SJHA Handmade</p>
  `,
});
