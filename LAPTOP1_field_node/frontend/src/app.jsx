import { useState } from "react";

import Header from "./components/Header.jsx";
import StatusBadge from "./components/StatusBadge.jsx";
import UploadPanel from "./components/UploadPanel.jsx";

import { detectImage } from "./api.js";


function App() {

  // Small local confirmation, plus the full result (image, detections)
  // shown below — this is also mirrored to Laptop 2's dashboard.
  const [sentInfo, setSentInfo] = useState(null);

  const [result, setResult] = useState(null);

  const [loading, setLoading] =
    useState(false);


  const handleDetection = async (file) => {

    try {

      setLoading(true);

      setSentInfo(null);

      setResult(null);


      const data =
        await detectImage(file);


      setSentInfo({
        count: data.detections?.length || 0,
        timestamp: data.timestamp,
      });

      setResult(data);

    }

    catch (error) {

      console.error(error);

      alert(
        error.message ||
        "Could not connect to AI backend."
      );

    }

    finally {

      setLoading(false);

    }

  };


  return (

    <div className="app">

      {/* HEADER */}

      <Header />


      {/* MAIN */}

      <main className="main-container">


        {/* TOP STATUS */}

        <div className="top-status">

          <StatusBadge
            loading={loading}
          />

        </div>


        {/* UPLOAD */}

        <div className="dashboard-grid">

          <UploadPanel
            onDetect={handleDetection}
            loading={loading}
          />

        </div>


        {/* SENT CONFIRMATION — full result also mirrored to Laptop 2 */}

        {sentInfo && (

          <div className="sent-confirmation">

            ✅ Sent to Command Center — {sentInfo.count} object
            {sentInfo.count === 1 ? "" : "s"} detected at{" "}
            {new Date(sentInfo.timestamp).toLocaleTimeString()}.
            <br />
            Also sent to Laptop 2's dashboard and map.

          </div>

        )}


        {/* DETECTION RESULT — image + detected objects, right here too */}

        {result && (

          <div className="result-panel">

            <h2>Detection Result</h2>

            {result.image && (

              <img
                className="result-image"
                src={`data:image/jpeg;base64,${result.image}`}
                alt="Annotated detection result"
              />

            )}

            <div className="result-list">

              {result.detections.length === 0 && (

                <p className="upload-message">
                  No objects detected in this image.
                </p>

              )}

              {result.detections.map((d, i) => (

                <div key={i} className="result-item">

                  <span className="result-item-class">
                    {d.class}
                  </span>

                  <span className="result-item-confidence">
                    {(d.confidence * 100).toFixed(1)}%
                  </span>

                </div>

              ))}

            </div>

          </div>

        )}


      </main>

    </div>

  );
}


export default App;
