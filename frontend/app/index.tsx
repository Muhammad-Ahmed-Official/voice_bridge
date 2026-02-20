// Render main app (login/home) at root so initial load shows Voice Bridge login, not blank "index"
import MainApp from './(tabs)/index';

export default function Index() {
  return <MainApp />;
}
