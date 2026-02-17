'use client';

import { useEffect, useState } from 'react';

type HealthStatus = {
  status?: string;
  error?: string;
} | null;

export default function HealthPage() {
  const [status, setStatus] = useState<HealthStatus>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`)
      .then((res) => res.json())
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch((err) => {
        setStatus({ error: err.message });
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold mb-4">System Health</h1>
      {loading ? (
        <p>Checking API...</p>
      ) : (
        <pre className="bg-muted p-4 rounded-md">
          {JSON.stringify(status, null, 2)}
        </pre>
      )}
    </div>
  );
}
