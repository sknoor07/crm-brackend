import crypto from 'crypto';

export const generateJobNumber = () => {
  return `JOB-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
};
