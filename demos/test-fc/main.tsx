import { useState } from 'react';
import ReactDOM from 'react-dom/client';

function App() {
	const [num, setNum] = useState(100);

	return <div onClick={() => setNum(num + 2)}>{num}</div>;
}

function Child() {
	return <span>big-react123</span>;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<App />
);
