import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/StartPage.vue') },
      { path: 'builder', component: () => import('pages/OrganBuilderPage.vue') },
      { path: 'preview', component: () => import('pages/TsunamiPreviewPage.vue') }
    ],
  },
  {
    path: '/worker',
    component: () => import('pages/WorkerPage.vue')
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
