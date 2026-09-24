function StatusBadge({ loading = false }) {

  return (

    <div
      className={`status-badge ${
        loading ? "status-processing" : ""
      }`}
    >

      <span className="status-dot"></span>

      {loading
        ? "AI ANALYZING"
        : "SYSTEM ONLINE"
      }

    </div>

  );
}


export default StatusBadge;