import { formatResponse } from '../lib/core.mjs';

export default async (req, context) => {
  return formatResponse(200, { message: 'Notify function ready' });
};
