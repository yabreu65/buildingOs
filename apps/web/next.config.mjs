/** @type {import('next').NextConfig} */
const nextConfig = {
  // IMPORTANT: usar hosts/origins (sin path). En dev, permitir tu IP local.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.1.56",
    "*.local",
    "*.localhost",
  ],
};

export default nextConfig;
