import { SCOREBOARD } from "../data/site.js";

// The eval scoreboard from the README's real run, set as a departure board
export default function Board() {
  return (
    <figure className="board">
      <div className="plate">
        <table className="board__table">
          <caption className="visually-hidden">Output of npx ragforge eval on 12 npm package READMEs</caption>
          <thead>
            <tr>
              <th scope="col">Technique</th>
              <th scope="col" className="num">Hit@5</th>
              <th scope="col" className="num col-mrr">MRR</th>
              <th scope="col" className="num col-latency">Latency</th>
              <th scope="col" className="num">Cost per query</th>
            </tr>
          </thead>
          <tbody>
            {SCOREBOARD.map((row) => (
              <tr key={row.technique}>
                <th scope="row" className="board__name">
                  {row.technique}
                  {row.recommended && <span className="tag">recommended</span>}
                </th>
                <td className="num board__hit">{row.hit}</td>
                <td className="num col-mrr">{row.mrr}</td>
                <td className="num col-latency">{row.latency}</td>
                <td className={`num${row.recommended ? "" : " board__dim"}`}>{row.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="stat">
        <span className="stat__figure">350×</span>
        <span className="stat__line">HyDE's cost per query against plain search, at a lower hit rate</span>
      </div>
      <figcaption>A real run: 12 npm READMEs, 30 questions, gpt-4o-mini.</figcaption>
    </figure>
  );
}
