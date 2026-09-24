import { useState } from "react";


function UploadPanel({
  onDetect,
  loading
}) {

  const [selectedFile, setSelectedFile] =
    useState(null);


  const handleFileChange = (event) => {

    const file =
      event.target.files[0];

    if (!file) {
      return;
    }

    setSelectedFile(file);

  };


  const handleDetect = () => {

    if (!selectedFile) {

      alert(
        "Please select an image first."
      );

      return;
    }


    onDetect(selectedFile);

  };


  return (

    <section className="upload-panel">

      <div className="panel-header">

        <h2>
          Image Detection
        </h2>

        <p>
          Upload a drone or field image to detect
          people, fire, flood and vehicles.
        </p>

      </div>


      {/* UPLOAD AREA */}

      <label className="upload-area">

        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
        />


        <div className="upload-icon">
          ↑
        </div>


        <h3>
          Upload Image
        </h3>


        <p>
          Click here to select an image
        </p>


        <span>
          JPG, JPEG or PNG
        </span>

      </label>


      {/* FILE NAME */}

      {selectedFile && (

        <div className="selected-file">

          <span>
            ◉
          </span>

          <span>
            {selectedFile.name}
          </span>

        </div>

      )}


      {/* DETECT BUTTON */}

      <button
        className="detect-button"
        onClick={handleDetect}
        disabled={loading}
      >

        {loading
          ? "ANALYZING IMAGE..."
          : "DETECT OBJECTS"
        }

      </button>


      {!loading && !selectedFile && (

        <p className="upload-message">
          Select an image to begin AI detection.
        </p>

      )}


      {!loading && selectedFile && (

        <p className="upload-message ready">
          Image ready for AI detection.
        </p>

      )}

    </section>

  );
}


export default UploadPanel;