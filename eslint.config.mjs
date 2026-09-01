import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ["drizzle/**", ".next/**", "node_modules/**"],
  },
];

export default eslintConfig;
