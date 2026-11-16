import { useEffect } from 'react';
import { Home } from './pages/Home';
import { RoomPage } from './pages/RoomPage';
import { useRoute } from './router';
import { setIndexable } from './seo';
import { FeedbackWidget } from './ui/FeedbackWidget';

export function App() {
  const route = useRoute();
  const isRoom = route.page === 'room';
  // 방 화면은 검색에 나오지 않게 표시한다
  useEffect(() => setIndexable(!isRoom), [isRoom]);
  return (
    <>
      {route.page === 'room' ? <RoomPage key={route.roomId} roomId={route.roomId} /> : <Home />}
      <FeedbackWidget placement={isRoom ? 'room' : 'home'} />
    </>
  );
}
