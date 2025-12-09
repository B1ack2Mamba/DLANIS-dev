/** @type {import('next').NextConfig} */
const nextConfig = {
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "harlequin-implicit-prawn-315.mypinata.cloud",
                pathname: "/ipfs/**",
            },
        ],
    },
};

module.exports = nextConfig;
