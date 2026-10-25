import App from '../App';
import { FocusOnNavigate } from './FocusOnNavigate';

/**
 * The Module 7 usability prototype, mounted unchanged. It keeps its own hash routes
 * (`#/`, `#/demo`, `#/research`) under `/prototype/`; the browser router matches on the
 * pathname only, so the hash stays the prototype's.
 */
export function PrototypeRoute() {
  return (
    <>
      <FocusOnNavigate title="FootballOS — AI-assisted film review (prototype)" />
      <App />
    </>
  );
}
