import MainComponent from 'pages/MainComponent.vue';

const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: MainComponent },
      { path: '/dump', redirect: '/' },
      { path: '/compare', redirect: '/' },
      { path: '/apply', redirect: '/' },
    ],
  },
  { path: '/:catchAll(.*)*', component: () => import('pages/ErrorNotFound.vue') },
];


export default routes;
