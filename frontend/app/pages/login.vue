<script setup lang="ts">
import { ref } from 'vue';
import { StudioError } from '../composables/useStudio';

const MSG_BAD_PASSPHRASE = '口令不正确';
const MSG_LOCKED = '尝试次数过多，请 15 分钟后再试';

const session = useOwnerSession();
const studio = useStudio();

const passphrase = ref('');
const submitting = ref(false);
const error = ref('');

async function submit() {
  if (submitting.value) return;
  if (!passphrase.value) {
    error.value = MSG_BAD_PASSPHRASE;
    return;
  }
  submitting.value = true;
  error.value = '';
  try {
    const res = await studio.request<{ token: string; expiresAt: number | string }>('/v1/auth/login', {
      method: 'POST',
      body: { passphrase: passphrase.value },
      anonymous: true,
    });
    const expiresAt = typeof res.expiresAt === 'number' ? res.expiresAt : Date.parse(res.expiresAt);
    session.login({ token: res.token, expiresAt });
    passphrase.value = '';
    await navigateTo('/');
  } catch (e) {
    if (e instanceof StudioError) {
      if (e.status === 401) error.value = MSG_BAD_PASSPHRASE;
      else if (e.status === 429) error.value = MSG_LOCKED;
      else if (e.status === 0) error.value = e.message;
      else error.value = `登录失败（${e.status}）`;
    } else {
      error.value = '登录失败';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="login">
    <h1>登录小屋</h1>
    <form @submit.prevent="submit">
      <label for="passphrase">口令</label>
      <input
        id="passphrase"
        v-model="passphrase"
        type="password"
        autocomplete="current-password"
        maxlength="128"
        :disabled="submitting"
      />
      <button type="submit" :disabled="submitting">{{ submitting ? '登录中…' : '登录' }}</button>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>
  </section>
</template>

<style scoped>
.login {
  max-width: 360px;
  margin: 48px auto;
}
form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
input {
  padding: 8px 10px;
  border: 1px solid #c9b8e8;
  border-radius: 8px;
}
button {
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: #9b5de5;
  color: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.error {
  color: #c0392b;
  margin: 0;
}
</style>
