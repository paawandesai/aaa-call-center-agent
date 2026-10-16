import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "pg", "@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  outputFileTracingIncludes: { "/*": ["./db/migrations/*.sql", "./eval-results/*.json"] },
};
export default nextConfig;
