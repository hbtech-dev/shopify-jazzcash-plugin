export const loader = () => {
  const robots = `User-agent: *
Disallow: /app
Disallow: /auth
Allow: /
`;

  return new Response(robots, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
