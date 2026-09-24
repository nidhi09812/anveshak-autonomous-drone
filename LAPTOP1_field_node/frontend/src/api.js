// Override via a .env file (VITE_API_BASE_URL=http://127.0.0.1:8001) if
// this backend isn't running on the default port — e.g. when testing
// both laptops solo on one machine and 8000 is already taken by
// LAPTOP2's relay_server.py.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";


export async function detectImage(file) {

  const formData = new FormData();

  formData.append("file", file);


  const response = await fetch(
    `${API_BASE_URL}/detect`,
    {
      method: "POST",
      body: formData
    }
  );


  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Backend returned an invalid response."
    );
  }


  if (!response.ok) {

    throw new Error(
      data?.error ||
      "Image detection failed."
    );
  }


  if (!data.success) {

    throw new Error(
      data.error ||
      "Detection failed."
    );
  }


  return data;
}