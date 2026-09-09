---
id: "9ca7ca6c-a460-4d64-9997-f6a73611f3a3"
term: "Conditional expectation"
label: "条件期望"
created: "2026-09-09T15:35:45.244Z"
updated: "2026-09-09T15:35:45.244Z"
kind: "concept"
links: []
---

# Conditional expectation · 条件期望

## 概念解释

条件期望是指在给定另一个随机变量（或事件）取某个特定值的条件下，某个随机变量的期望值。它表示在已知部分信息后，对该随机变量平均水平的预测。

## 在原文中的用法

在本段中，条件期望被定义为通过条件密度函数 $f_{Y|X}(y \mid x)$ 对 $y$ 进行积分得到的表达式，即 $\mathbb{E}[Y \mid X = x] = \int_{-\infty}^{\infty} y f_{Y|X}(y \mid x) \, \mathrm{d}y$。这里 $X=x$ 是给定的条件，$Y$ 的分布由条件密度描述。注意，条件期望是 $x$ 的函数，而不是随机变量本身；若未固定 $X$，则 $\mathbb{E}[Y \mid X]$ 是 $X$ 的函数，但此处公式针对固定观测值 $x$。

## 原文

**Conditional expectation**

Conditional expectation can be expressed using a conditional density:

$$\mathbb{E}[Y \mid X = x] = \int_{-\infty}^{\infty} y f_{Y|X}(y \mid x) \, \mathrm{d}y.$$

The sample mean and a symmetric matrix are:

$$\bar{x} = \frac{1}{n} \sum_{i=1}^{n} x_i, \qquad A = \begin{pmatrix} a & b \\ b & c \end{pmatrix}.$$

## 我的理解
