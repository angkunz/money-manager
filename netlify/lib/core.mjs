// Core shared helper functions and utilities

export function formatResponse(statusCode, data) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
