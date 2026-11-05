export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const response = await fetch(
      `${process.env.BACKEND_URL ?? "http://127.0.0.1:8000"}/ingest`,
      {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(300_000),
      },
    );

    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    return Response.json(
      { detail: error instanceof Error ? error.message : "PDF upload failed" },
      { status: 502 },
    );
  }
}
