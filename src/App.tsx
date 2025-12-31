import GameCanvas from "./GameCanvas";

export default function App() {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#111" }}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "grid",
          placeItems: "center",
        }}
      >
        <GameCanvas />
      </div>

      <div
        style={{
          position: "fixed",
          left: 12,
          bottom: 12,
          color: "#aaa",
          font: "12px/1.4 system-ui",
          userSelect: "none",
        }}
      >
        드래그/마우스로 좌우 이동. 게이트 통과로 수치 변경. 좀비는 자동 사격.
      </div>
    </div>
  );
}
