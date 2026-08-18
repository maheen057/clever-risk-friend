declare module "*/ssa/App.jsx" {
  const App: () => JSX.Element;
  export default App;
}
declare module "../ssa/App.jsx" {
  import type { ComponentType } from "react";
  const App: ComponentType;
  export default App;
}
