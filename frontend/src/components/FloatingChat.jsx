import React, { useEffect, useMemo, useRef, useState } from 'react';
import './FloatingChat.css';

const CHAT_SERVER = ''; // 로컬 서버 연동을 위해 비움

const buildWsBaseUrl = (serverUrl) => {
    // 1. Explicit server URL (e.g., hardcoded or from env)
    if (serverUrl) {
        try {
            const parsed = new URL(serverUrl);
            const scheme = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${scheme}//${parsed.host}`;
        } catch (err) { }
    }

    // 2. Fallback to current window location
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let host = window.location.host; // e.g., 'localhost:5173' or '34.42.223.43'

    // 개발 환경 (Vite는 다른 포트 사용)
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
        // 로컬 개발 시 Django 서버 포트로 연결
        if (host.includes(':')) {
            const [hostname, port] = host.split(':');
            // Vite 포트(5173)를 Django 포트(8000)로 변경
            if (port === '5173' || port === '3000') {
                host = `${hostname}:8000`;
            }
        } else {
            host = `${host}:8000`;
        }
    } else {
        // 프로덕션 환경: Nginx가 /ws를 프록시하므로 같은 호스트 사용
        // 포트 없이 사용 (Nginx가 80 포트에서 /ws를 8000으로 프록시)
        // host는 그대로 사용 (예: '34.42.223.43')
    }

    return `${scheme}//${host}`;
};

const API_BASE_URL = CHAT_SERVER;
const WS_BASE_URL = buildWsBaseUrl(CHAT_SERVER);

const buildApiUrl = (path) => (API_BASE_URL ? `${API_BASE_URL}${path}` : path);

const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return undefined;
};

const formatTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? '오후' : '오전';
    hours %= 12;
    hours = hours || 12;
    return `${ampm} ${hours}:${minutes}`;
};

const formatDateLabel = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dateStr = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
    const dayStr = days[date.getDay()];
    return `${dateStr} ${dayStr}요일`;
};

const isImage = (filename) => (/\\.(jpg|jpeg|png|gif|webp|bmp)$/i).test(filename || '');

const getRoomLabel = (room) => {
    const name = room?.name || '';
    if (name.startsWith('case:dm:')) return '1:1 대화';
    return name.replace(/^(case|dept|shift):/, '');
};

const FloatingChat = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [currentUser, setCurrentUser] = useState(null);
    const [currentTab, setCurrentTab] = useState('friends');
    const [friends, setFriends] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [currentRoom, setCurrentRoom] = useState(null);
    const [messages, setMessages] = useState([]);
    const [headerTitle, setHeaderTitle] = useState('의료진 채팅');
    const [headerStatus, setHeaderStatus] = useState('대기 중');
    const [messageInput, setMessageInput] = useState('');
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedUserIds, setSelectedUserIds] = useState(new Set());
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createChatType, setCreateChatType] = useState(null); // 'dm' or 'group'
    const [searchQuery, setSearchQuery] = useState('');
    const [friendSearchQuery, setFriendSearchQuery] = useState('');
    const [selectedDepartment, setSelectedDepartment] = useState('all');
    const [showOnlineOnly, setShowOnlineOnly] = useState(false);
    const [departments, setDepartments] = useState([]);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [selectedUserProfile, setSelectedUserProfile] = useState(null);

    const chatMessagesRef = useRef(null);
    const messageInputRef = useRef(null);
    const fileInputRef = useRef(null);
    const socketRef = useRef(null);
    const notifySocketRef = useRef(null);
    const notifyReconnectTimerRef = useRef(null);
    const isHistoryLoadingRef = useRef(false);
    const pendingMessagesRef = useRef([]);

    const currentRoomRef = useRef(currentRoom);
    const currentTabRef = useRef(currentTab);
    const currentUserRef = useRef(currentUser);
    const isOpenRef = useRef(isOpen);
    const friendsRef = useRef(friends);

    useEffect(() => {
        currentRoomRef.current = currentRoom;
    }, [currentRoom]);

    useEffect(() => {
        currentTabRef.current = currentTab;
    }, [currentTab]);

    useEffect(() => {
        currentUserRef.current = currentUser;
    }, [currentUser]);

    useEffect(() => {
        isOpenRef.current = isOpen;
    }, [isOpen]);

    useEffect(() => {
        friendsRef.current = friends;
    }, [friends]);

    const buildMessengerApiUrl = (path) => {
        const messengerPath = path.startsWith('/api/chat/')
            ? path.replace('/api/chat/', '/api/messenger/chat/')
            : path;
        return buildApiUrl(messengerPath);
    };

    const updateTotalUnreadFromAPI = async () => {
        try {
            const res = await fetch(buildMessengerApiUrl('/api/chat/rooms/'), { credentials: 'include' });
            if (!res.ok) return;
            const roomsData = await res.json();
            const isPopupOpen = isOpenRef.current;
            const currentRoomName = currentRoomRef.current?.name;
            const totalUnreadCount = roomsData.reduce((sum, room) => {
                if (isPopupOpen && room.name === currentRoomName) {
                    return sum;
                }
                return sum + (room.unread_count || 0);
            }, 0);
            setUnreadCount(totalUnreadCount);
        } catch (err) {
            console.error('읽지 않은 메시지 조회 실패:', err);
        }
    };

    const connectNotifications = () => {
        if (!currentUserRef.current) {
            console.log('알림 WebSocket: 사용자 정보 없음');
            return;
        }
        const existing = notifySocketRef.current;
        if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
            console.log('알림 WebSocket: 이미 연결 중');
            return;
        }

        const wsUrl = `${WS_BASE_URL}/ws/notifications/`;
        console.log('알림 WebSocket 연결 시도:', wsUrl);
        const socket = new WebSocket(wsUrl);
        notifySocketRef.current = socket;

        socket.onopen = () => {
            console.log('알림 WebSocket 연결 성공');
        };

        socket.onmessage = (event) => {
            let data = null;
            try {
                data = JSON.parse(event.data);
            } catch (err) {
                console.error('알림 메시지 파싱 실패:', err);
                return;
            }

            console.log('알림 수신:', data.type);

            if (data.type === 'notify_message') {
                // 알림 배지는 채팅방을 열지 않았을 때만 업데이트
                // 현재 채팅방이 열려있고 그 방의 메시지라면 배지 업데이트 안 함
                const currentRoomName = currentRoomRef.current?.name;
                const notifiedRoomName = data.data?.room_name;
                
                // 다른 방의 메시지이거나 채팅방이 열려있지 않을 때만 배지 업데이트
                if (!currentRoomName || currentRoomName !== notifiedRoomName) {
                    updateTotalUnreadFromAPI();
                }
                
                if (currentTabRef.current === 'chats') {
                    loadRooms();
                }
                return;
            }

            if (data.type === 'notify_read') {
                updateTotalUnreadFromAPI();
            }
        };

        socket.onerror = (error) => {
            console.error('알림 WebSocket 오류:', error);
        };

        socket.onclose = (event) => {
            console.log('알림 WebSocket 연결 종료:', event.code, event.reason);
            if (notifySocketRef.current === socket) {
                notifySocketRef.current = null;
            }
            if (notifyReconnectTimerRef.current) return;
            notifyReconnectTimerRef.current = setTimeout(() => {
                notifyReconnectTimerRef.current = null;
                console.log('알림 WebSocket 재연결 시도...');
                connectNotifications();
            }, 5000);
        };
    };
    const loadFriends = async () => {
        try {
            const res = await fetch(buildMessengerApiUrl('/api/chat/users/'), { credentials: 'include' });
            if (!res.ok) return;
            const users = await res.json();
            const me = currentUserRef.current;
            const list = me ? users.filter((u) => u.id !== me.id) : users;
            setFriends(list);
            
            // 부서 목록 추출
            const deptSet = new Set();
            list.forEach((user) => {
                if (user.department) {
                    deptSet.add(user.department);
                }
            });
            const deptList = Array.from(deptSet).sort();
            setDepartments(deptList);
        } catch (err) {
            console.error('친구 로드 실패:', err);
        }
    };

    const loadRooms = async () => {
        try {
            const res = await fetch(buildMessengerApiUrl('/api/chat/rooms/'), { credentials: 'include' });
            if (!res.ok) return;
            const roomsData = await res.json();
            const me = currentUserRef.current;

            const totalUnreadCount = roomsData.reduce((sum, room) => sum + (room.unread_count || 0), 0);
            setUnreadCount(totalUnreadCount);

            const userMap = new Map();
            friendsRef.current.forEach((user) => userMap.set(user.id, user));
            if (me) userMap.set(me.id, me);

            const roomsWithNames = await Promise.all(
                roomsData.map(async (room) => {
                    let friendName = null;

                    if (room.room_type === 'group' && room.participants && me) {
                        const isMe = room.participants.some((u) => u.id === me.id);
                        if (!isMe) return null;
                    }

                    if (room.name.startsWith('case:dm:') && me) {
                        const parts = room.name.split(':');
                        const ids = parts.slice(2).map((id) => parseInt(id, 10));
                        const friendId = ids.find((id) => id !== me.id);

                        if (room.participants) {
                            const friend = room.participants.find((u) => u.id === friendId);
                            if (friend) friendName = friend.name || friend.username;
                        }

                        if (!friendName && friendId) {
                            const friend = userMap.get(friendId);
                            friendName = friend?.name || friend?.username || null;
                        }

                        if (!friendName) friendName = '1:1 대화';
                    } else if (room.name.startsWith('group:')) {
                        if (room.participants && me) {
                            const names = room.participants
                                .filter((u) => u.id !== me.id)
                                .map((u) => u.name || u.username);
                            const uniqueNames = [...new Set(names)];
                            friendName = uniqueNames.join(', ');
                        }
                        if (!friendName) friendName = '그룹 채팅';
                    }

                    return { ...room, friendName };
                })
            );

            setRooms(roomsWithNames.filter(Boolean));
        } catch (err) {
            console.error('대화방 로드 실패:', err);
        }
    };

    const loadData = () => {
        if (!currentUserRef.current) return;
        if (currentTabRef.current === 'friends') {
            loadFriends();
        } else {
            loadRooms();
        }
    };

    const updateHeaderForRoom = async (room) => {
        if (!room) {
            setHeaderTitle('의료진 채팅');
            setHeaderStatus('대기 중');
            return;
        }

        const me = currentUserRef.current;

        if (room.name && room.name.startsWith('case:dm:') && me) {
            let title = room.friendName || null;
            if (!title && room.participants) {
                const friend = room.participants.find((u) => u.id !== me.id);
                title = friend?.name || friend?.username || null;
            }
            if (!title) title = '1:1 대화';
            setHeaderTitle(title);
            return;
        }

        if (room.name && room.name.startsWith('group:')) {
            if (room.friendName) {
                setHeaderTitle(room.friendName);
            } else if (room.participants && me) {
                const names = room.participants
                    .filter((u) => u.id !== me.id)
                    .map((u) => u.name || u.username);
                const uniqueNames = [...new Set(names)];
                setHeaderTitle(uniqueNames.join(', ') || '그룹 채팅');
            } else {
                setHeaderTitle('그룹 채팅');
            }

            if (room.participant_count) {
                setHeaderStatus(`${room.participant_count}명`);
            } else if (room.participants) {
                setHeaderStatus(`${room.participants.length}명`);
            }
            return;
        }

        setHeaderTitle(getRoomLabel(room));
    };

    const markRoomAsRead = async (roomId, updateBadge = true) => {
        if (!roomId) return;
        try {
            console.log('읽음 처리 시작:', roomId, 'updateBadge:', updateBadge);
            const res = await fetch(buildMessengerApiUrl(`/api/chat/rooms/${roomId}/mark-read/`), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken'),
                    'Content-Type': 'application/json',
                },
            });

            if (res.ok) {
                // 채팅방 목록의 unread_count를 0으로 업데이트
                setRooms((prev) => prev.map((room) => (
                    room.id === roomId ? { ...room, unread_count: 0 } : room
                )));
                
                // 현재 채팅방이 열려있으면 메시지의 unread_count도 업데이트
                if (currentRoomRef.current?.id === roomId) {
                    // 내가 보낸 메시지가 아닌 메시지들의 unread_count를 0으로 설정
                    setMessages((prev) => prev.map((msg) => {
                        const me = currentUserRef.current;
                        // 내가 보낸 메시지가 아니면 unread_count를 0으로 (읽었으므로)
                        if (me && msg.sender?.id !== me.id) {
                            return { ...msg, unread_count: 0 };
                        }
                        return msg;
                    }));
                    console.log('메시지 읽음 상태 업데이트 완료');
                }
                
                // 채팅방이 열려있을 때는 알림 배지 업데이트 안 함 (너무 빨리 사라지는 문제 방지)
                // 사용자가 직접 채팅방을 열 때만 알림 배지 업데이트
                if (updateBadge) {
                    updateTotalUnreadFromAPI();
                }
                console.log('읽음 처리 완료:', roomId);
            } else {
                console.error('읽음 처리 실패:', res.status);
            }
        } catch (err) {
            console.error('읽음 처리 실패:', err);
        }
    };

    const refreshReadStatusFromAPI = async (roomId) => {
        if (!roomId) return;
        try {
            console.log('읽음 상태 API 갱신 시작:', roomId);
            const res = await fetch(buildMessengerApiUrl(`/api/chat/rooms/${roomId}/messages/?limit=50&mark_read=0`), {
                credentials: 'include',
            });
            if (!res.ok) {
                console.error('읽음 상태 API 갱신 실패:', res.status);
                return;
            }
            const messagesData = await res.json();
            const messageMap = new Map(messagesData.map((msg) => [String(msg.id), msg]));

            setMessages((prev) => {
                const updated = prev.map((msg) => {
                    const updatedMsg = messageMap.get(String(msg.id));
                    if (!updatedMsg) return msg;
                    // unread_count가 변경되었는지 확인
                    if (msg.unread_count !== updatedMsg.unread_count) {
                        console.log('메시지 읽음 상태 갱신:', msg.id, msg.unread_count, '->', updatedMsg.unread_count);
                    }
                    return { ...msg, unread_count: updatedMsg.unread_count };
                });
                return updated;
            });
            console.log('읽음 상태 API 갱신 완료');
        } catch (err) {
            console.error('읽음 상태 갱신 실패:', err);
        }
    };

    const getRoomIdByName = async (roomName) => {
        try {
            const res = await fetch(buildMessengerApiUrl('/api/chat/rooms/'), { credentials: 'include' });
            if (!res.ok) return null;
            const roomsData = await res.json();
            const found = roomsData.find((room) => room.name === roomName);
            return found ? found.id : null;
        } catch (err) {
            return null;
        }
    };

    const connectToRoom = async (roomName, roomId, roomData) => {
        if (!roomName) return;

        if (socketRef.current) {
            socketRef.current.onclose = null;
            socketRef.current.close();
            socketRef.current = null;
        }

        const nextRoom = roomData || { id: roomId, name: roomName };
        setCurrentRoom(nextRoom);
        // 메시지는 useEffect에서 WebSocket 연결 후 message_history로 로드됨
        // 여기서는 초기화만 하고, 실제 로드는 WebSocket 연결 후 서버에서 받음
        pendingMessagesRef.current = [];
        isHistoryLoadingRef.current = false;

        await updateHeaderForRoom(nextRoom);

        if (roomId) {
            // 채팅방을 열 때는 즉시 읽음 처리 (카카오톡 방식)
            // 알림 배지는 업데이트 (사용자가 직접 열었으므로)
            markRoomAsRead(roomId, true);
        }
    };

    const openDM = async (targetUserId) => {
        const me = currentUserRef.current;
        if (!me) return;

        try {
            const u1 = Math.min(me.id, targetUserId);
            const u2 = Math.max(me.id, targetUserId);
            const caseKey = `dm:${u1}:${u2}`;

            const res = await fetch(buildMessengerApiUrl('/api/chat/rooms/'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken'),
                },
                body: JSON.stringify({
                    room_type: 'case',
                    case_key: caseKey,
                    participant_ids: [targetUserId],
                }),
                credentials: 'include',
            });

            if (!res.ok) {
                const txt = await res.text();
                console.error('DM Create Error:', txt);
                alert('대화방 열기 실패');
                return;
            }

            const room = await res.json();
            await connectToRoom(room.name, room.id, room);
        } catch (err) {
            console.error('DM Error:', err);
            alert('오류가 발생했습니다.');
        }
    };

    const createChat = async () => {
        if (selectedUserIds.size === 0) return;

        try {
            const userIds = Array.from(selectedUserIds);
            
            if (createChatType === 'dm' && userIds.length === 1) {
                // 개인채팅
                await openDM(userIds[0]);
            } else if (createChatType === 'group') {
                // 그룹채팅
                const res = await fetch(buildMessengerApiUrl('/api/chat/rooms/'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken'),
                    },
                    body: JSON.stringify({
                        room_type: 'group',
                        participant_ids: userIds,
                    }),
                    credentials: 'include',
                });

                if (!res.ok) {
                    console.error('그룹 생성 실패', await res.text());
                    alert('그룹 생성 실패');
                    return;
                }

                const room = await res.json();
                await connectToRoom(room.name, room.id, room);
            }
            
            closeCreateChatModal();
        } catch (err) {
            console.error('에러:', err);
            alert('채팅방 생성에 실패했습니다.');
        }
    };

    const createGroupChat = async () => {
        // 기존 함수는 유지 (하위 호환성)
        if (selectedUserIds.size === 0) return;
        await createChat();
    };

    const showListView = () => {
        setCurrentRoom(null);
        setMessages([]);
        setHeaderTitle('의료진 채팅');
        setHeaderStatus('대기 중');
        if (socketRef.current) {
            socketRef.current.onclose = null;
            socketRef.current.close();
            socketRef.current = null;
        }
        loadData();
    };

    const leaveRoom = async () => {
        const roomId = currentRoomRef.current?.id;
        if (!roomId) return;
        if (!confirm('채팅방을 나가시겠습니까? 대화방 목록에서 사라집니다.')) return;

        try {
            const res = await fetch(buildMessengerApiUrl(`/api/chat/rooms/${roomId}/leave/`), {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken'),
                },
                credentials: 'include',
            });

            if (res.ok || res.status === 204) {
                setCurrentTab('chats');
                showListView();
                updateTotalUnreadFromAPI();
            } else {
                alert(`나가기 실패 (코드: ${res.status})`);
            }
        } catch (err) {
            alert(`오류 발생: ${err.message}`);
        }
    };

    const sendMessageRef = useRef(false); // 중복 전송 방지 플래그
    const isComposingRef = useRef(false); // 한글 입력 조합 중 플래그

    const sendMessage = () => {
        // 중복 전송 방지: 이미 전송 중이면 무시
        if (sendMessageRef.current) {
            console.log('메시지 전송 중복 방지');
            return;
        }

        // 한글 입력 조합 중이면 전송하지 않음
        if (isComposingRef.current) {
            console.log('한글 입력 조합 중, 전송 대기');
            return;
        }

        const content = messageInput.trim();
        if (!content) return;
        const socket = socketRef.current;
        
        if (!socket) {
            console.error('WebSocket이 연결되지 않았습니다.');
            alert('채팅 연결이 끊어졌습니다. 페이지를 새로고침해주세요.');
            return;
        }
        
        if (socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket 상태:', socket.readyState);
            alert('채팅 연결이 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        // 전송 중 플래그 설정
        sendMessageRef.current = true;
        
        // 입력 필드를 먼저 완전히 비우기 (한글 조합 문제 방지)
        if (messageInputRef.current) {
            messageInputRef.current.value = ''; // DOM 직접 조작으로 확실히 비우기
            messageInputRef.current.style.height = 'auto';
        }
        setMessageInput(''); // React state도 비우기

        try {
            const payload = {
                type: 'chat_message',
                content,
            };
            console.log('메시지 전송:', payload, 'Socket:', socket.readyState);
            // 서버로 전송 (서버 응답으로 chat_message 이벤트가 오면 그때 표시됨)
            socket.send(JSON.stringify(payload));
            
            // 전송 완료 후 플래그 해제 (짧은 딜레이로 중복 전송 방지)
            setTimeout(() => {
                sendMessageRef.current = false;
            }, 500);
        } catch (err) {
            console.error('메시지 전송 실패:', err);
            alert('메시지 전송에 실패했습니다. 다시 시도해주세요.');
            // 실패 시 입력 복원 및 플래그 해제
            setMessageInput(content);
            sendMessageRef.current = false;
        }
    };

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const me = currentUserRef.current;
        if (!me) {
            alert('사용자 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
            event.target.value = '';
            return;
        }

        const roomName = currentRoomRef.current?.name;
        const roomId = currentRoomRef.current?.id || (roomName ? await getRoomIdByName(roomName) : null);
        if (!roomId) {
            alert('채팅방을 찾을 수 없습니다.');
            event.target.value = '';
            return;
        }

        try {
            const formData = new FormData();
            formData.append('file', file);

            const uploadRes = await fetch(buildMessengerApiUrl('/api/chat/files/'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken'),
                },
                body: formData,
            });

            if (!uploadRes.ok) {
                const errorText = await uploadRes.text();
                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.error && errorData.error[0] === 'File extension not allowed.') {
                        alert(
                            '⚠️ 지원하지 않는 파일 형식입니다.\n\n' +
                            '파일 전송은 다음 형식만 가능합니다:\n\n' +
                            '이미지: PNG, JPG, JPEG, GIF, WEBP\n' +
                            '문서: PDF, DOCX, DOC, XLSX, XLS, PPTX, PPT\n' +
                            '텍스트: TXT, MD\n' +
                            '한글: HWP, HWPX'
                        );
                    } else if (errorData.error && errorData.error[0].includes('exceeds')) {
                        alert('⚠️ 파일 크기가 너무 큽니다.\n\n최대 50MB까지 업로드 가능합니다.');
                    } else {
                        alert(`파일 업로드 실패: ${errorData.error?.[0] || errorText}`);
                    }
                } catch (err) {
                    alert(`파일 업로드 실패: ${errorText}`);
                }
                event.target.value = '';
                return;
            }

            const uploadData = await uploadRes.json();
            const msgRes = await fetch(buildMessengerApiUrl(`/api/chat/rooms/${roomId}/messages/`), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken'),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: '',
                    attachment_id: uploadData.id,
                }),
            });

            if (!msgRes.ok) {
                const errorText = await msgRes.text();
                throw new Error(errorText || '파일 메시지 전송 실패');
            }
        } catch (err) {
            console.error('파일 전송 오류:', err);
            alert(`파일 전송 실패: ${err.message}`);
        }

        event.target.value = '';
    };

    const openCreateChatModal = () => {
        setShowCreateModal(true);
        setCreateChatType(null);
        setSelectedUserIds(new Set());
        setSearchQuery('');
        loadFriends();
    };

    const closeCreateChatModal = () => {
        setShowCreateModal(false);
        setCreateChatType(null);
        setIsSelectionMode(false);
        setSelectedUserIds(new Set());
        setSearchQuery('');
    };

    const selectChatType = (type) => {
        setCreateChatType(type);
        setIsSelectionMode(true);
        setSelectedUserIds(new Set());
    };

    const cancelSelectionMode = () => {
        setIsSelectionMode(false);
        setSelectedUserIds(new Set());
        setSearchQuery('');
    };

    const toggleUserSelection = (userId) => {
        setSelectedUserIds((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) {
                next.delete(userId);
            } else {
                next.add(userId);
            }
            return next;
        });
    };

    useEffect(() => {
        const init = async () => {
            try {
                const res = await fetch(buildMessengerApiUrl('/api/chat/users/me/'), { credentials: 'include' });
                if (!res.ok) return;
                const user = await res.json();
                currentUserRef.current = user;
                setCurrentUser(user);
                connectNotifications();
                updateTotalUnreadFromAPI();
            } catch (err) {
                console.error('사용자 정보 로드 실패:', err);
            }
        };

        init();
    }, []);

    useEffect(() => {
        if (isOpen && currentUser) {
            loadData();
        }
    }, [isOpen, currentTab, currentUser]);

    useEffect(() => {
        const interval = setInterval(() => {
            if (!isOpenRef.current) {
                updateTotalUnreadFromAPI();
            }
        }, 30000);

        return () => clearInterval(interval);
    }, []);

    const loadMessagesFromAPI = async (roomId) => {
        if (!roomId) return;
        
        isHistoryLoadingRef.current = true;
        const currentPending = [...pendingMessagesRef.current];
        pendingMessagesRef.current = [];

        try {
            const res = await fetch(buildMessengerApiUrl(`/api/chat/rooms/${roomId}/messages/?limit=50&mark_read=1`), {
                credentials: 'include',
            });
            if (!res.ok) {
                console.error('메시지 로드 실패:', res.status);
                return;
            }
            const messagesData = await res.json();
            const baseMessages = messagesData || [];
            const existingIds = new Set(baseMessages.map((msg) => msg.id));
            // pending 메시지 중 중복되지 않은 것만 추가
            const pendingMessages = currentPending.filter((msg) => !existingIds.has(msg.id));
            setMessages([...baseMessages, ...pendingMessages]);
            console.log('메시지 로드 완료:', baseMessages.length, '개, pending:', pendingMessages.length);
        } catch (err) {
            console.error('메시지 로드 실패:', err);
        } finally {
            isHistoryLoadingRef.current = false;
        }
    };

    useEffect(() => {
        if (!currentRoom?.name) {
            setHeaderStatus('대기 중');
            // 기존 소켓 정리
            if (socketRef.current) {
                const oldSocket = socketRef.current;
                oldSocket.onopen = null;
                oldSocket.onmessage = null;
                oldSocket.onerror = null;
                oldSocket.onclose = null;
                if (oldSocket.readyState === WebSocket.OPEN || oldSocket.readyState === WebSocket.CONNECTING) {
                    oldSocket.close();
                }
                socketRef.current = null;
            }
            return;
        }

        // 이미 같은 방에 연결되어 있는지 확인
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            const currentRoomName = currentRoomRef.current?.name;
            if (currentRoomName === currentRoom.name) {
                console.log('이미 같은 방에 연결되어 있음:', currentRoomName);
                return;
            }
        }

        const wsUrl = `${WS_BASE_URL}/ws/chat/${currentRoom.name}/`;
        console.log('WebSocket 연결 시도:', wsUrl, 'WS_BASE_URL:', WS_BASE_URL, 'currentRoom:', currentRoom);
        
        // 기존 소켓이 있으면 먼저 정리
        if (socketRef.current) {
            const oldSocket = socketRef.current;
            oldSocket.onopen = null;
            oldSocket.onmessage = null;
            oldSocket.onerror = null;
            oldSocket.onclose = null;
            if (oldSocket.readyState === WebSocket.OPEN || oldSocket.readyState === WebSocket.CONNECTING) {
                oldSocket.close();
            }
        }
        
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        setHeaderStatus('연결 중...');

        socket.onopen = () => {
            console.log('WebSocket 연결 성공 (onopen 호출됨):', wsUrl);
            setHeaderStatus('연결됨');
            // 채팅방이 열리면 즉시 읽음 처리 (카카오톡 방식)
            const roomId = currentRoomRef.current?.id;
            if (roomId) {
                // 약간의 딜레이를 주어 메시지 로드 후 읽음 처리
                setTimeout(() => {
                    markRoomAsRead(roomId, false); // 알림 배지는 업데이트 안 함
                }, 300);
            }
        };

        socket.onmessage = (event) => {
            let data = null;
            try {
                data = JSON.parse(event.data);
            } catch (err) {
                return;
            }

            if (data.type === 'message_history') {
                const roomId = currentRoomRef.current?.id;
                if (data.data?.messages) {
                    // 서버에서 직접 메시지 목록을 받은 경우
                    const historyMessages = data.data.messages || [];
                    const existingIds = new Set(historyMessages.map((msg) => msg.id));
                    const pendingMessages = pendingMessagesRef.current.filter((msg) => !existingIds.has(msg.id));
                    setMessages([...historyMessages, ...pendingMessages]);
                    console.log('메시지 히스토리 수신:', historyMessages.length, '개');
                    
                    // 메시지 로드 후 읽음 처리 (카카오톡 방식)
                    if (roomId) {
                        setTimeout(() => {
                            markRoomAsRead(roomId, false);
                        }, 200);
                    }
                } else if (roomId) {
                    // roomId가 있으면 API로 로드
                    loadMessagesFromAPI(roomId);
                }
                return;
            }

            if (data.type === 'chat_message') {
                const message = data.data.message;
                const me = currentUserRef.current;
                
                // 중복 메시지 체크 (ID로 확인) - 더 엄격한 체크
                setMessages((prev) => {
                    // ID로 중복 체크
                    const existingById = prev.find((msg) => msg.id === message.id);
                    if (existingById) {
                        console.log('중복 메시지 무시 (ID):', message.id, message.content);
                        return prev;
                    }
                    
                    // 같은 내용, 같은 발신자, 같은 시간(2초 이내)인 경우도 중복으로 간주
                    const me = currentUserRef.current;
                    if (me && message?.sender?.id === me.id) {
                        // 최근 3개 메시지 확인 (더 엄격한 중복 체크)
                        const recentMessages = prev.slice(-3);
                        for (const recentMsg of recentMessages) {
                            if (recentMsg.sender?.id === me.id) {
                                // 내용이 완전히 같거나, 새 메시지가 이전 메시지의 끝부분과 같으면 중복
                                if (recentMsg.content === message.content) {
                                    const timeDiff = new Date(message.timestamp) - new Date(recentMsg.timestamp);
                                    if (timeDiff < 2000) { // 2초 이내
                                        console.log('중복 메시지 무시 (동일 내용):', message.content);
                                        return prev;
                                    }
                                } else if (message.content.length > 0 && recentMsg.content.length > 0) {
                                    // 새 메시지가 이전 메시지의 끝부분과 같으면 중복 (예: "안녕" -> "녕")
                                    const recentEnd = recentMsg.content.slice(-message.content.length);
                                    if (recentEnd === message.content) {
                                        const timeDiff = new Date(message.timestamp) - new Date(recentMsg.timestamp);
                                        if (timeDiff < 2000) { // 2초 이내
                                            console.log('중복 메시지 무시 (끝부분 일치):', recentMsg.content, '->', message.content);
                                            return prev;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    console.log('새 메시지 추가:', message.id, message.content);
                    return [...prev, message];
                });

                // 상대방 메시지인 경우 읽음 처리 (채팅방이 열려있을 때만 - 카카오톡 방식)
                // 채팅방이 열려있으면 자동으로 읽은 것으로 간주
                if (me && message?.sender?.id !== me.id) {
                    // 채팅방이 열려있으므로 즉시 읽음 처리
                    const roomId = currentRoomRef.current?.id;
                    if (roomId) {
                        // 알림 배지는 업데이트 안 함 (이미 채팅방이 열려있으므로)
                        markRoomAsRead(roomId, false);
                    }
                    // 메시지의 unread_count도 즉시 0으로 설정 (화면에 표시되는 "1" 제거)
                    setMessages((prev) => prev.map((msg) => {
                        if (msg.id === message.id && msg.sender?.id !== me.id) {
                            return { ...msg, unread_count: 0 };
                        }
                        return msg;
                    }));
                }
                return;
            }

            if (data.type === 'message_read_status') {
                const readUserId = data.data.user_id;
                const messageId = data.data.message_id;
                const roomId = data.data.room_id;
                const me = currentUserRef.current;
                
                console.log('읽음 상태 업데이트 이벤트 수신:', { readUserId, messageId, roomId, myId: me?.id, currentRoomId: currentRoomRef.current?.id });
                
                // 현재 채팅방이 열려있고, 내가 보낸 메시지를 상대방이 읽은 경우에만 업데이트
                if (roomId && currentRoomRef.current?.id === roomId && me) {
                    // 특정 메시지 ID가 있으면 해당 메시지만 업데이트
                    if (messageId) {
                        setMessages((prev) => {
                            const updated = prev.map((msg) => {
                                if (msg.id === messageId && msg.sender?.id === me.id) {
                                    // 내가 보낸 메시지의 unread_count 감소
                                    const newUnreadCount = Math.max(0, (msg.unread_count || 1) - 1);
                                    console.log('메시지 읽음 상태 업데이트 (실시간):', messageId, msg.unread_count, '->', newUnreadCount);
                                    return { ...msg, unread_count: newUnreadCount };
                                }
                                return msg;
                            });
                            return updated;
                        });
                    } else {
                        // messageId가 없으면 즉시 API로 최신 읽음 상태 가져오기
                        console.log('전체 메시지 읽음 상태 갱신 (실시간)');
                        refreshReadStatusFromAPI(roomId);
                    }
                }
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket 오류:', error, 'URL:', wsUrl);
            setHeaderStatus('연결 오류');
        };

        socket.onclose = (event) => {
            console.log('WebSocket 연결 종료:', event.code, event.reason, 'wasClean:', event.wasClean, 'URL:', wsUrl);
            // cleanup에서 호출된 경우가 아니고, 현재 방이 여전히 같은 경우에만 상태 업데이트
            if (socketRef.current === socket && currentRoomRef.current?.name === currentRoom.name) {
                if (event.code !== 1000) {  // 정상 종료가 아닌 경우
                    setHeaderStatus('연결 종료');
                    // 비정상 종료 시 재연결 시도
                    const roomName = currentRoomRef.current.name;
                    setTimeout(() => {
                        if (currentRoomRef.current?.name === roomName && !socketRef.current) {
                            console.log('WebSocket 재연결 시도...');
                            // 재연결을 위해 currentRoom을 다시 설정
                            const room = currentRoomRef.current;
                            setCurrentRoom(null);
                            setTimeout(() => {
                                setCurrentRoom(room);
                            }, 100);
                        }
                    }, 3000);
                }
            }
        };

        return () => {
            if (socketRef.current === socket) {
                socket.onopen = null;
                socket.onmessage = null;
                socket.onerror = null;
                socket.onclose = null;
                if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                    socket.close();
                }
                socketRef.current = null;
            }
        };
    }, [currentRoom?.name]);

    useEffect(() => {
        const container = chatMessagesRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
    }, [messages]);

    useEffect(() => {
        const handleFocus = () => {
            const roomId = currentRoomRef.current?.id;
            if (roomId) markRoomAsRead(roomId);
        };

        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const renderedMessages = useMemo(() => {
        const items = [];
        let lastDate = null;
        const me = currentUser;
        const isDMRoom = currentRoom?.name?.startsWith('case:dm:');

        messages.forEach((msg) => {
            const dateLabel = formatDateLabel(msg.timestamp);
            if (dateLabel && lastDate !== dateLabel) {
                lastDate = dateLabel;
                items.push(
                    <div className="chat-date-divider" key={`date-${dateLabel}`}>
                        <span className="chat-date-label">{dateLabel}</span>
                    </div>
                );
            }

            const sender = msg.sender || {};
            const senderName = sender.name || sender.username || '알 수 없음';
            const isMine = me && sender.id === me.id;
            // 내가 보낸 메시지의 unread_count만 표시 (카카오톡 방식)
            // 상대방이 보낸 메시지는 unread_count 표시 안 함
            let displayUnreadCount = 0;
            if (isMine) {
                // 내가 보낸 메시지: 상대방이 읽지 않은 수
                displayUnreadCount = typeof msg.unread_count === 'number' ? msg.unread_count : 0;
            }

            items.push(
                <div className={`chat-message ${isMine ? 'mine' : ''}`} key={msg.id}>
                    {!isMine && (
                        <div className="chat-message-avatar">{senderName[0] || '?'}</div>
                    )}
                    <div className="chat-message-content">
                        {!isMine && (
                            <div className="chat-message-name">{senderName}</div>
                        )}
                        <div className="message-body">
                            <div className="message-bubble-wrapper">
                                {msg.content && (
                                    <div className="chat-message-bubble">{msg.content}</div>
                                )}
                                {msg.attachment_url && (
                                    <div className="chat-message-attachment">
                                        <a href={msg.attachment_url} target="_blank" rel="noreferrer">
                                            {isImage(msg.attachment_name) ? (
                                                <img src={msg.attachment_url} alt={msg.attachment_name || ''} />
                                            ) : (
                                                `📎 ${msg.attachment_name || '첨부파일'}`
                                            )}
                                        </a>
                                    </div>
                                )}
                            </div>
                            <div className="chat-message-meta">
                                {displayUnreadCount > 0 && (
                                    <span className="read-status unread">{displayUnreadCount}</span>
                                )}
                                <span className="chat-message-time">{formatTime(msg.timestamp)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            );
        });

        return items;
    }, [messages, currentRoom, currentUser]);

    const unreadBadge = unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : null;
    return (
        <div className="floating-chat">
            {!isOpen && (
                <button
                    className="chat-trigger"
                    onClick={() => setIsOpen(true)}
                    title="채팅 열기"
                    type="button"
                >
                    <svg viewBox="0 0 24 24">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
                    </svg>
                    {unreadBadge && (
                        <span className="badge">{unreadBadge}</span>
                    )}
                </button>
            )}

            <div className={`chat-popup ${isOpen ? 'active' : ''}`}>
                <div className="chat-header">
                    <div className="chat-header-left">
                        <div>
                            <div className="chat-header-title">{headerTitle}</div>
                            <div className="chat-header-status">{headerStatus}</div>
                        </div>
                    </div>
                    {currentRoom && (
                        <button
                            className="chat-header-btn"
                            onClick={showListView}
                            title="돌아가기"
                            type="button"
                        >
                            <svg viewBox="0 0 24 24">
                                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                            </svg>
                        </button>
                    )}
                    {currentRoom && (
                        <button
                            className="chat-header-btn"
                            onClick={leaveRoom}
                            title="나가기"
                            type="button"
                        >
                            <svg viewBox="0 0 24 24" style={{ width: '20px', height: '20px' }}>
                                <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                            </svg>
                        </button>
                    )}
                    <button
                        className="chat-header-btn"
                        onClick={() => setIsOpen(false)}
                        title="최소화"
                        type="button"
                    >
                        <svg viewBox="0 0 24 24">
                            <path d="M19 13H5v-2h14v2z" />
                        </svg>
                    </button>
                </div>

                <div className={`chat-view ${currentRoom ? 'hidden' : ''}`}>
                    <div className="chat-tabs">
                        <button
                            className={`chat-tab ${currentTab === 'friends' ? 'active' : ''}`}
                            onClick={() => setCurrentTab('friends')}
                            type="button"
                        >
                            동료
                        </button>
                        <button
                            className={`chat-tab ${currentTab === 'chats' ? 'active' : ''}`}
                            onClick={() => setCurrentTab('chats')}
                            type="button"
                        >
                            대화방
                        </button>
                    </div>

                    {/* 동료 탭: 검색 및 필터 기능 */}
                    {currentTab === 'friends' && (
                        <div className="friends-toolbar">
                            <div className="friends-search">
                                <svg className="friends-search-icon" viewBox="0 0 24 24">
                                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                                </svg>
                                <input
                                    type="text"
                                    placeholder="동료 검색..."
                                    value={friendSearchQuery}
                                    onChange={(e) => setFriendSearchQuery(e.target.value)}
                                    className="friends-search-input"
                                />
                                {friendSearchQuery && (
                                    <button
                                        className="friends-search-clear"
                                        onClick={() => setFriendSearchQuery('')}
                                        type="button"
                                    >
                                        <svg viewBox="0 0 24 24">
                                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                            <div className="friends-filters">
                                <select
                                    className="friends-filter-select"
                                    value={selectedDepartment}
                                    onChange={(e) => setSelectedDepartment(e.target.value)}
                                >
                                    <option value="all">전체 부서</option>
                                    {departments.map((dept) => (
                                        <option key={dept} value={dept}>
                                            {dept}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    className={`friends-filter-btn ${showOnlineOnly ? 'active' : ''}`}
                                    onClick={() => setShowOnlineOnly(!showOnlineOnly)}
                                    type="button"
                                    title="온라인만 보기"
                                >
                                    <svg viewBox="0 0 24 24">
                                        <circle cx="12" cy="12" r="10" fill="currentColor" />
                                    </svg>
                                    <span>온라인</span>
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="chat-list" style={{ position: 'relative' }}>
                        {currentTab === 'friends' && friends.length === 0 && (
                            <div className="chat-empty">
                                <svg viewBox="0 0 24 24">
                                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
                                </svg>
                                <h3>등록된 동료가 없습니다</h3>
                                <p>동료를 추가하고 대화를 시작하세요</p>
                            </div>
                        )}

                        {currentTab === 'friends' && (() => {
                            // 필터링된 동료 목록
                            let filteredFriends = friends;
                            
                            // 검색 필터
                            if (friendSearchQuery) {
                                const query = friendSearchQuery.toLowerCase();
                                filteredFriends = filteredFriends.filter((user) => {
                                    const name = (user.name || user.username || '').toLowerCase();
                                    const department = (user.department || '').toLowerCase();
                                    const role = (user.role || '').toLowerCase();
                                    return name.includes(query) || department.includes(query) || role.includes(query);
                                });
                            }
                            
                            // 부서 필터
                            if (selectedDepartment !== 'all') {
                                filteredFriends = filteredFriends.filter((user) => user.department === selectedDepartment);
                            }
                            
                            // 온라인 필터
                            if (showOnlineOnly) {
                                filteredFriends = filteredFriends.filter((user) => user.is_online);
                            }
                            
                            // 최근 대화가 있는 동료 찾기
                            const friendsWithRooms = new Set();
                            const currentUser = currentUserRef.current;
                            if (currentUser) {
                                rooms.forEach((room) => {
                                    // case 타입 (개인 채팅)인 경우
                                    if (room.name && room.name.startsWith('case:dm:')) {
                                        const parts = room.name.split(':');
                                        if (parts.length >= 3) {
                                            const ids = parts.slice(2).map((id) => parseInt(id, 10));
                                            const friendId = ids.find((id) => id !== currentUser.id);
                                            if (friendId) {
                                                friendsWithRooms.add(friendId);
                                            }
                                        }
                                    }
                                    // participants가 있는 경우 (group 또는 다른 타입)
                                    if (room.participants && Array.isArray(room.participants)) {
                                        room.participants.forEach((p) => {
                                            if (p.id && p.id !== currentUser.id) {
                                                friendsWithRooms.add(p.id);
                                            }
                                        });
                                    }
                                });
                            }
                            
                            return filteredFriends.length === 0 ? (
                                <div className="chat-empty">
                                    <svg viewBox="0 0 24 24">
                                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
                                    </svg>
                                    <h3>검색 결과가 없습니다</h3>
                                    <p>다른 검색어나 필터를 시도해보세요</p>
                                </div>
                            ) : (
                                filteredFriends.map((friendUser) => {
                                    const hasExistingRoom = friendsWithRooms.has(friendUser.id);
                                    const currentUser = currentUserRef.current;
                                    return (
                                        <div
                                            key={friendUser.id}
                                            className={`chat-list-item ${isSelectionMode ? 'selection-mode' : ''} ${hasExistingRoom ? 'has-room' : ''}`}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setSelectedUserProfile(friendUser);
                                                setShowProfileModal(true);
                                            }}
                                            onClick={(e) => {
                                                if (isSelectionMode) {
                                                    toggleUserSelection(friendUser.id);
                                                } else {
                                                    // 일반 클릭은 프로필 표시
                                                    e.stopPropagation();
                                                    setSelectedUserProfile(friendUser);
                                                    setShowProfileModal(true);
                                                }
                                            }}
                                        >
                                            {isSelectionMode && (
                                                <input
                                                    type="checkbox"
                                                    className="friend-checkbox"
                                                    checked={selectedUserIds.has(friendUser.id)}
                                                    onChange={() => toggleUserSelection(friendUser.id)}
                                                    onClick={(event) => event.stopPropagation()}
                                                />
                                            )}
                                            <div className={`chat-list-avatar ${friendUser.is_online ? 'online' : ''}`}>
                                                {(friendUser.name || friendUser.username || '?')[0]}
                                            </div>
                                            <div className="chat-list-content">
                                                <div className="chat-list-top">
                                                    <span className="chat-list-name">
                                                        {friendUser.name || friendUser.username}
                                                        {hasExistingRoom && (
                                                            <span className="has-room-badge" title="최근 대화 있음">💬</span>
                                                        )}
                                                    </span>
                                                    <span className="chat-list-time">{friendUser.is_online ? '온라인' : ''}</span>
                                                </div>
                                                <div className="chat-list-preview">{friendUser.department || friendUser.role || '의료진'}</div>
                                            </div>
                                        </div>
                                    );
                                })
                            );
                        })()}

                        {currentTab === 'chats' && rooms.length === 0 && (
                            <div className="chat-empty">
                                <svg viewBox="0 0 24 24">
                                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
                                </svg>
                                <h3>대화방이 없습니다</h3>
                                <p>동료를 선택하여 채팅을 시작하세요</p>
                            </div>
                        )}

                        {currentTab === 'chats' && rooms.map((room) => (
                            <div
                                key={room.id}
                                className="chat-list-item"
                                onClick={() => connectToRoom(room.name, room.id, room)}
                            >
                                <div className="chat-list-avatar">💬</div>
                                <div className="chat-list-content">
                                    <div className="chat-list-top">
                                        <span className="chat-list-name">{room.friendName || getRoomLabel(room)}</span>
                                        <span className="chat-list-time">{formatTime(room.last_message_at || room.created_at)}</span>
                                    </div>
                                    <div className="chat-list-preview">{room.last_message?.content || '새 대화'}</div>
                                </div>
                                {room.unread_count > 0 && (
                                    <span className="chat-list-badge">{room.unread_count > 99 ? '99+' : room.unread_count}</span>
                                )}
                            </div>
                        ))}

                        {/* 대화방 탭에 + 버튼 추가 (오른쪽 하단) */}
                        {currentTab === 'chats' && (
                            <button
                                className="chat-create-btn"
                                onClick={openCreateChatModal}
                                title="새 채팅 만들기"
                                type="button"
                            >
                                <svg viewBox="0 0 24 24">
                                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                <div className={`chat-room ${currentRoom ? '' : 'hidden'}`}>
                    <div
                        className="chat-messages"
                        ref={chatMessagesRef}
                        onClick={() => {
                            const roomId = currentRoomRef.current?.id;
                            if (roomId) markRoomAsRead(roomId);
                        }}
                    >
                        {renderedMessages}
                    </div>
                    <div className="chat-composer">
                        <button
                            className="chat-composer-btn"
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            title="파일 첨부"
                        >
                            <svg viewBox="0 0 24 24">
                                <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" />
                            </svg>
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            onChange={handleFileUpload}
                        />
                        <textarea
                            className="chat-composer-input"
                            ref={messageInputRef}
                            value={messageInput}
                            placeholder="메시지를 입력하세요"
                            rows={1}
                            onCompositionStart={() => {
                                isComposingRef.current = true;
                                console.log('한글 입력 조합 시작');
                            }}
                            onCompositionEnd={() => {
                                isComposingRef.current = false;
                                console.log('한글 입력 조합 종료');
                            }}
                            onChange={(event) => {
                                setMessageInput(event.target.value);
                                event.target.style.height = 'auto';
                                event.target.style.height = `${event.target.scrollHeight}px`;
                            }}
                            onFocus={() => {
                                // 입력 필드에 포커스가 가면 읽음 처리 (카카오톡 방식)
                                const roomId = currentRoomRef.current?.id;
                                if (roomId) {
                                    markRoomAsRead(roomId, false); // 알림 배지는 업데이트 안 함
                                }
                            }}
                            onKeyDown={(event) => {
                                // 한글 입력 조합 중이면 Enter 키 무시
                                if (isComposingRef.current) {
                                    return;
                                }
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    sendMessage();
                                }
                            }}
                        />
                        <button
                            className="chat-composer-send"
                            type="button"
                            onClick={sendMessage}
                            disabled={!messageInput.trim()}
                        >
                            <svg viewBox="0 0 24 24">
                                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* 채팅 생성 모달 */}
            {showCreateModal && (
                <div className="chat-create-modal-overlay" onClick={closeCreateChatModal}>
                    <div className="chat-create-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="chat-create-modal-header">
                            <h3>새 채팅 만들기</h3>
                            <button className="chat-create-modal-close" onClick={closeCreateChatModal} type="button">
                                <svg viewBox="0 0 24 24">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                </svg>
                            </button>
                        </div>

                        {!createChatType ? (
                            <div className="chat-create-type-selector">
                                <button
                                    className="chat-create-type-btn"
                                    onClick={() => selectChatType('dm')}
                                    type="button"
                                >
                                    <svg viewBox="0 0 24 24">
                                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                                    </svg>
                                    <span>개인채팅</span>
                                </button>
                                <button
                                    className="chat-create-type-btn"
                                    onClick={() => selectChatType('group')}
                                    type="button"
                                >
                                    <svg viewBox="0 0 24 24">
                                        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                                    </svg>
                                    <span>팀채팅</span>
                                </button>
                            </div>
                        ) : (
                            <div className="chat-create-user-selector">
                                <div className="chat-create-search">
                                    <input
                                        type="text"
                                        placeholder="동료 검색..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="chat-create-search-input"
                                    />
                                    <svg className="chat-create-search-icon" viewBox="0 0 24 24">
                                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                                    </svg>
                                </div>

                                <div className="chat-create-user-list">
                                    {friends
                                        .filter((user) => {
                                            if (!searchQuery) return true;
                                            const query = searchQuery.toLowerCase();
                                            const name = (user.name || user.username || '').toLowerCase();
                                            const department = (user.department || '').toLowerCase();
                                            return name.includes(query) || department.includes(query);
                                        })
                                        .map((user) => (
                                            <div
                                                key={user.id}
                                                className={`chat-create-user-item ${selectedUserIds.has(user.id) ? 'selected' : ''}`}
                                                onClick={() => {
                                                    if (createChatType === 'dm' && selectedUserIds.size > 0 && !selectedUserIds.has(user.id)) {
                                                        // 개인채팅은 1명만 선택 가능
                                                        setSelectedUserIds(new Set([user.id]));
                                                    } else {
                                                        toggleUserSelection(user.id);
                                                    }
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedUserIds.has(user.id)}
                                                    onChange={() => {
                                                        if (createChatType === 'dm' && selectedUserIds.size > 0 && !selectedUserIds.has(user.id)) {
                                                            setSelectedUserIds(new Set([user.id]));
                                                        } else {
                                                            toggleUserSelection(user.id);
                                                        }
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                                <div className={`chat-list-avatar ${user.is_online ? 'online' : ''}`}>
                                                    {(user.name || user.username || '?')[0]}
                                                </div>
                                                <div className="chat-list-info">
                                                    <div className="chat-list-name">{user.name || user.username}</div>
                                                    <div className="chat-list-preview">{user.department || user.role || '의료진'}</div>
                                                </div>
                                            </div>
                                        ))}
                                </div>

                                <div className="chat-create-actions">
                                    <button
                                        className="chat-create-cancel-btn"
                                        onClick={cancelSelectionMode}
                                        type="button"
                                    >
                                        뒤로
                                    </button>
                                    <button
                                        className="chat-create-confirm-btn"
                                        onClick={createChat}
                                        disabled={
                                            selectedUserIds.size === 0 ||
                                            (createChatType === 'dm' && selectedUserIds.size !== 1)
                                        }
                                        type="button"
                                    >
                                        완료 ({selectedUserIds.size})
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 프로필 모달 */}
            {showProfileModal && selectedUserProfile && (
                <div className="chat-create-modal-overlay" onClick={() => setShowProfileModal(false)}>
                    <div className="chat-create-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
                        <div className="chat-create-modal-header">
                            <h3>의사 정보</h3>
                            <button className="chat-create-modal-close" onClick={() => setShowProfileModal(false)} type="button">
                                <svg viewBox="0 0 24 24">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                </svg>
                            </button>
                        </div>

                        <div className="profile-modal-content">
                            <div className="profile-avatar-large">
                                <div className={`chat-list-avatar ${selectedUserProfile.is_online ? 'online' : ''}`} style={{ width: '80px', height: '80px', fontSize: '32px' }}>
                                    {(selectedUserProfile.name || selectedUserProfile.username || '?')[0]}
                                </div>
                            </div>
                            <div className="profile-info">
                                <h4 className="profile-name">{selectedUserProfile.name || selectedUserProfile.username}</h4>
                                <div className="profile-detail">
                                    <div className="profile-detail-item">
                                        <span className="profile-label">부서</span>
                                        <span className="profile-value">{selectedUserProfile.department || selectedUserProfile.role || '의료진'}</span>
                                    </div>
                                    <div className="profile-detail-item">
                                        <span className="profile-label">상태</span>
                                        <span className="profile-value">
                                            {selectedUserProfile.is_online ? (
                                                <span style={{ color: 'var(--success)' }}>온라인</span>
                                            ) : (
                                                <span style={{ color: 'var(--text-secondary)' }}>오프라인</span>
                                            )}
                                        </span>
                                    </div>
                                    {selectedUserProfile.username && (
                                        <div className="profile-detail-item">
                                            <span className="profile-label">사용자명</span>
                                            <span className="profile-value">{selectedUserProfile.username}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="profile-actions">
                                    <button
                                        className="chat-create-confirm-btn"
                                        onClick={() => {
                                            setShowProfileModal(false);
                                            openDM(selectedUserProfile.id);
                                        }}
                                        type="button"
                                    >
                                        메시지 보내기
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FloatingChat;
