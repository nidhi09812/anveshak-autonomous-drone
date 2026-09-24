// URL of the LAPTOP1 field backend (FastAPI + YOLO). Set via
// VITE_API_BASE_URL in production (Vercel env var); falls back to the
// local dev default when unset.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function detectImage(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/detect`, {
    method: "POST",
    body: formData,
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Backend returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(data?.error || "Image detection failed.");
  }

  if (!data.success) {
    throw new Error(data.error || "Detection failed.");
  }

  return data;
}
