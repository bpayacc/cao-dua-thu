/**
 * services/authService.js
 * -----------------------------------------------------------------------
 * ĐÃ CHUYỂN SANG FIREBASE AUTH THẬT (không còn localStorage cho tài khoản).
 * Tên hàm và hình dạng dữ liệu trả về được giữ nguyên như trước để không
 * phải sửa lại các trang đã gọi authService — mọi hàm là async, nơi gọi
 * phải dùng await (các trang trong dự án đã được cập nhật sẵn).
 *
 * Firebase Auth quản lý: email, mật khẩu (mã hoá), xác minh email, phiên
 * đăng nhập. Firestore (collection "users", id = uid) lưu thêm: fullName,
 * phone, role, avatarColor — những trường Firebase Auth không có.
 * -----------------------------------------------------------------------
 */
import { auth, db } from '../config/firebaseClient.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile as updateAuthProfile,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { ROLES } from '../config/constants.js';

// Firebase xác định trạng thái đăng nhập bất đồng bộ ngay sau khi tải trang.
// authReady đảm bảo getCurrentUser() luôn chờ đúng kết quả lần đầu đó,
// tránh trả về "chưa đăng nhập" sai trong khoảnh khắc đầu tiên.
let resolveAuthReady;
const authReady = new Promise((resolve) => { resolveAuthReady = resolve; });
let cachedFirebaseUser = null;

onAuthStateChanged(auth, (firebaseUser) => {
  cachedFirebaseUser = firebaseUser;
  resolveAuthReady();
});

/** Không còn cần seed dữ liệu (Firebase là dữ liệu thật) — giữ hàm rỗng để khỏi phải sửa mọi trang gọi nó. */
export function initAuthData() {}

/**
 * Đăng ký tài khoản khách hàng mới bằng Firebase Auth + tạo hồ sơ Firestore.
 * Tự động gửi email xác minh sau khi tạo tài khoản thành công.
 */
export async function register({ fullName, email, password }) {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);

    await updateAuthProfile(credential.user, { displayName: fullName });
    await sendEmailVerification(credential.user);

    await setDoc(doc(db, 'users', credential.user.uid), {
      fullName,
      phone: '',
      role: ROLES.CUSTOMER,
      avatarColor: randomAvatarColor(),
      createdAt: serverTimestamp(),
    });

    return {
      success: true,
      message: 'Đăng ký thành công! Vui lòng kiểm tra email để xác minh tài khoản.',
      user: await buildUser(credential.user),
    };
  } catch (error) {
    return { success: false, message: mapFirebaseError(error) };
  }
}

/**
 * Đăng nhập bằng email + mật khẩu qua Firebase Auth.
 * Yêu cầu của dự án: chặn đăng nhập nếu email chưa được xác minh — Firebase
 * Auth vẫn tạo phiên đăng nhập hợp lệ cho tài khoản chưa xác minh, nên phải
 * tự kiểm tra `emailVerified` và signOut() ngay nếu chưa xác minh, tránh
 * user chưa xác minh lọt vào hệ thống.
 */
export async function login(email, password) {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);

    if (!credential.user.emailVerified) {
      await signOut(auth);
      return {
        success: false,
        message: 'Email chưa được xác minh. Vui lòng kiểm tra hộp thư và xác minh email trước khi đăng nhập.',
        unverified: true,
      };
    }

    return { success: true, message: 'Đăng nhập thành công!', user: await buildUser(credential.user) };
  } catch (error) {
    return { success: false, message: mapFirebaseError(error) };
  }
}

/**
 * Gửi lại email xác minh bằng email + mật khẩu (dùng khi user chưa đăng
 * nhập được vì email chưa xác minh — login() đã signOut() nên không thể
 * dùng resendVerificationEmail() lúc này, phải đăng nhập tạm để lấy lại
 * user rồi gửi email, sau đó signOut() lại ngay).
 */
export async function resendVerificationEmailByCredentials(email, password) {
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(credential.user);
    await signOut(auth);
    return { success: true, message: 'Đã gửi lại email xác minh, vui lòng kiểm tra hộp thư.' };
  } catch (error) {
    return { success: false, message: mapFirebaseError(error) };
  }
}

/** Đăng xuất khỏi Firebase Auth. */
export async function logout() {
  await signOut(auth);
}

/** Lấy user đang đăng nhập (đã gộp hồ sơ Firestore) hoặc null. */
export async function getCurrentUser() {
  await authReady;
  const firebaseUser = auth.currentUser || cachedFirebaseUser;
  if (!firebaseUser) return null;
  return buildUser(firebaseUser);
}

export async function isAuthenticated() {
  return (await getCurrentUser()) !== null;
}

export async function isAdmin() {
  const user = await getCurrentUser();
  return !!user && user.role === ROLES.ADMIN;
}

/** Cập nhật hồ sơ: họ tên (đồng bộ cả Firebase Auth) và số điện thoại (Firestore). */
export async function updateProfile(userId, updates) {
  try {
    if (updates.fullName && auth.currentUser) {
      await updateAuthProfile(auth.currentUser, { displayName: updates.fullName });
    }

    const firestoreUpdates = {};
    if (updates.fullName !== undefined) firestoreUpdates.fullName = updates.fullName;
    if (updates.phone !== undefined) firestoreUpdates.phone = updates.phone;
    await updateDoc(doc(db, 'users', userId), firestoreUpdates);

    return { success: true, message: 'Cập nhật hồ sơ thành công!', user: await getCurrentUser() };
  } catch (error) {
    return { success: false, message: mapFirebaseError(error) };
  }
}

/**
 * Đổi mật khẩu — Firebase yêu cầu xác thực lại (reauthenticate) bằng mật
 * khẩu hiện tại trước khi cho phép đổi, để đảm bảo an toàn.
 */
export async function changePassword(userId, currentPassword, newPassword) {
  try {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return { success: false, message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.' };

    const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
    await reauthenticateWithCredential(firebaseUser, credential);
    await updatePassword(firebaseUser, newPassword);

    return { success: true, message: 'Đổi mật khẩu thành công!' };
  } catch (error) {
    return { success: false, message: mapFirebaseError(error) };
  }
}

/** Gửi lại email xác minh cho tài khoản đang đăng nhập. */
export async function resendVerificationEmail() {
  if (!auth.currentUser) return { success: false, message: 'Bạn cần đăng nhập trước.' };
  try {
    await sendEmailVerification(auth.currentUser);
    return { success: true, message: 'Đã gửi lại email xác minh, vui lòng kiểm tra hộp thư.' };
  } catch (error) {
    return { success: false, message: mapFirebaseError(error) };
  }
}

/** Gửi email đặt lại mật khẩu (quên mật khẩu) tới địa chỉ email cho trước. */
export async function sendResetPasswordEmail(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return { success: true, message: 'Đã gửi email đặt lại mật khẩu, vui lòng kiểm tra hộp thư.' };
  } catch (error) {
    return { success: false, message: mapFirebaseError(error) };
  }
}

// ---- helper nội bộ ----

/** Gộp dữ liệu Firebase Auth (email, emailVerified) với hồ sơ Firestore (fullName, role...) */
async function buildUser(firebaseUser) {
  let profile = {};
  try {
    const snapshot = await getDoc(doc(db, 'users', firebaseUser.uid));
    if (snapshot.exists()) profile = snapshot.data();
  } catch (error) {
    // Nếu đọc Firestore lỗi (vd. mất mạng), vẫn trả về thông tin cơ bản từ Auth.
    console.error('[authService] Không đọc được hồ sơ Firestore:', error);
  }

  return {
    id: firebaseUser.uid,
    email: firebaseUser.email,
    emailVerified: firebaseUser.emailVerified,
    fullName: profile.fullName || firebaseUser.displayName || '',
    phone: profile.phone || '',
    role: profile.role || ROLES.CUSTOMER,
    avatarColor: profile.avatarColor || '#E2631F',
  };
}

function randomAvatarColor() {
  const palette = ['#E2631F', '#2E6F95', '#1F9254', '#B8322A', '#7C3AED'];
  return palette[Math.floor(Math.random() * palette.length)];
}

/** Dịch mã lỗi Firebase sang thông báo tiếng Việt dễ hiểu. */
function mapFirebaseError(error) {
  const map = {
    'auth/email-already-in-use': 'Email này đã được đăng ký. Vui lòng đăng nhập.',
    'auth/invalid-email': 'Email không đúng định dạng.',
    'auth/weak-password': 'Mật khẩu cần tối thiểu 6 ký tự.',
    'auth/user-not-found': 'Email hoặc mật khẩu không đúng.',
    'auth/wrong-password': 'Email hoặc mật khẩu không đúng.',
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
    'auth/too-many-requests': 'Bạn thử sai quá nhiều lần, vui lòng thử lại sau ít phút.',
    'auth/requires-recent-login': 'Vui lòng đăng nhập lại để thực hiện thao tác này.',
  };
  return map[error?.code] || `Đã có lỗi xảy ra (${error?.code || 'unknown'}), vui lòng thử lại.`;
}
