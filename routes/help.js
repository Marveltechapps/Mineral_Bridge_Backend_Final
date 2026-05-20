const express = require('express');
const { getDB } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_FAQS = [
  { id: '1', category: 'Payments', question: 'How do I add a payment method?', answer: 'Go to Profile > Payment Methods > Add New Method. You can link a Bank account or Crypto wallet.' },
  { id: '2', category: 'Payments', question: 'When will I receive my payout?', answer: 'Payouts are released after verification and custody handover. Typically within 3–5 business days.' },
  { id: '3', category: 'Verification', question: 'What documents are required for KYC?', answer: 'National ID, Passport, or Corporate License. You will need to upload front and back, plus complete a live selfie check.' },
  { id: '4', category: 'Orders', question: 'How do I track my order?', answer: 'Go to Profile > Order History and tap your order to see the full timeline and status.' },
  { id: '5', category: 'Selling', question: 'What is the verification process for listings?', answer: 'After you submit mineral details and logistics, a third-party verifier will inspect quality, weight, and origin. You will be notified at each step.' },
];

/**
 * GET /api/help/faqs
 * Query: ?category=... & ?q=... (search)
 * Returns FAQs for Help Center. Optional auth.
 */
router.get('/faqs', (req, res) => {
  const category = (req.query.category || '').trim();
  const q = (req.query.q || '').trim().toLowerCase();
  let list = DEFAULT_FAQS;
  if (category) list = list.filter((f) => f.category.toLowerCase() === category.toLowerCase());
  if (q) list = list.filter((f) => f.question.toLowerCase().includes(q) || (f.answer && f.answer.toLowerCase().includes(q)));
  res.json(list);
});

/**
 * GET /api/help/categories
 * Returns list of FAQ categories for browsing.
 */
router.get('/categories', (req, res) => {
  const categories = [...new Set(DEFAULT_FAQS.map((f) => f.category))];
  res.json(categories);
});

/**
 * POST /api/help/contact
 * Body: { type: 'email'|'callback'|'chat', category?, subject?, message? }
 * Records support request; in production would send email or create ticket.
 */
router.post('/contact', authMiddleware, async (req, res) => {
  try {
    const { type, category, subject, message } = req.body || {};
    const db = getDB();
    const doc = {
      userId: req.user.id,
      type: type === 'callback' ? 'callback' : type === 'chat' ? 'chat' : 'email',
      category: category || '',
      subject: subject || '',
      message: message || '',
      createdAt: new Date(),
    };
    await db.collection('support_requests').insertOne(doc);
    res.json({ success: true, message: type === 'callback' ? 'Callback requested. We will contact you shortly.' : 'Request received. Our team will get back to you.' });
  } catch (err) {
    console.error('POST /help/contact error:', err);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

module.exports = router;
