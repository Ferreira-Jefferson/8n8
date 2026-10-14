import axios from "axios";
import { main } from "./main.ts";

export function Tela() {
  axios.get(`${BASE}/api/frete`);
  return <div>{main()}</div>;
}
