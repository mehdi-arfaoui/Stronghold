import rateLimit from 'express-rate-limit';

function buildRateLimitMessage(): { error: { code: string; message: string } } {
  return {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Try again later.',
    },
  };
}

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: buildRateLimitMessage(),
});

export const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: buildRateLimitMessage(),
});
